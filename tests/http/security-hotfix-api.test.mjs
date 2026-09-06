import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { GroupBuyBatchService } from '../../server/services/catalog.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';
import { formatMoney } from '../../lib/storefront.ts';

// Read-only diagnostic: intentionally independent of status so historical rows are included.
const orphanCountSql = `SELECT COUNT(*) AS count FROM batch_commitments
  WHERE source_type = 'reservation' AND order_item_id IS NULL`;

async function setup() {
  const db = await createPhase4BDatabase();
  seed(db, `
    INSERT INTO users(id) VALUES ('resident'),('admin');
    INSERT INTO user_profiles(user_id,display_name,phone,email) VALUES
      ('resident','住戶','0900000001','same@example.test'),('admin','管理員','0900000002',NULL);
    INSERT INTO user_identities(id,user_id,provider,provider_user_id,verified) VALUES
      ('resident-identity','resident','chatgpt','resident-sub','true'),
      ('admin-identity','admin','chatgpt','admin-sub','true');
    INSERT INTO communities(id,name,slug) VALUES ('A','社區','a');
    INSERT INTO community_members(id,user_id,community_id,role) VALUES
      ('resident-member','resident','A','resident'),('admin-member','admin','A','community_admin');
    INSERT INTO products(id,name,source_type,unit_label) VALUES ('product','白米','manual','包');
    INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)
      VALUES ('offering','A','product',19900,10,1);
  `);
  const repositories = new Repositories({ db });
  // Test-only trusted adapter output: same verified ChatGPT semantics as runtime.ts.
  // This does not test the external production dispatcher or add a runtime bypass.
  let identity = null;
  const handle = createApplication(repositories, { async authenticate() { return identity; } });
  const call = async (method, path, subject, body) => {
    identity = subject ? { provider: 'chatgpt', providerUserId: subject, verified: true, email: 'same@example.test' } : null;
    const response = await handle(new Request(`http://local.test${path}`, {
      method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }));
    return { response, json: await response.json() };
  };
  const count = table => db.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const orphanCount = () => db.database.prepare(orphanCountSql).get().count;
  return { db, repositories, call, count, orphanCount };
}

function scenario(name, action) {
  test(name, async () => {
    const context = await setup();
    try { await action(context); } finally { context.db.close(); }
  });
}

scenario('identity link rejects arbitrary and owned subjects identically without any identity writes', async c => {
  const before = c.count('user_identities');
  for (const subject of ['unclaimed-sub', 'admin-sub', 'resident-sub']) {
    const r = await c.call('POST', '/api/me/identities/link', 'resident-sub', {
      provider: 'chatgpt', providerUserId: subject, verified: true,
    });
    assert.equal(r.response.status, 403);
    assert.deepEqual(r.json, { error: { code: 'IDENTITY_LINKING_DISABLED', message: '目前不開放綁定登入身份' } });
  }
  assert.equal(c.count('user_identities'), before);
  assert.equal(await c.repositories.identities.find('chatgpt', 'unclaimed-sub'), null);
  assert.equal(c.count('audit_logs'), 0);

  // A later trusted login provisions its own account, even with the same email.
  assert.equal((await c.call('GET', '/api/me/profile', 'unclaimed-sub')).response.status, 200);
  const fresh = await c.repositories.identities.find('chatgpt', 'unclaimed-sub');
  assert.notEqual(fresh.user_id, 'resident');
  assert.notEqual(fresh.user_id, 'admin');
  assert.equal(fresh.verified, 'true');
  assert.ok(await c.repositories.users.findById(fresh.user_id));
  assert.ok(await c.repositories.profiles.findByUserId(fresh.user_id));
  assert.equal(c.count('users'), 3);
  assert.equal(c.count('user_identities'), before + 1);
  assert.equal((await c.call('GET', '/api/me/profile', 'unclaimed-sub')).response.status, 200);
  assert.equal((await c.repositories.identities.find('chatgpt', 'unclaimed-sub')).user_id, fresh.user_id);
  assert.equal(c.count('users'), 3);
});

scenario('existing identity login and last identity unlink protection are unchanged', async c => {
  const r = await c.call('GET', '/api/me/profile', 'resident-sub');
  assert.equal(r.response.status, 200);
  assert.equal(r.json.profile.displayName, '住戶');
  assert.equal((await c.repositories.identities.find('chatgpt', 'resident-sub')).user_id, 'resident');
  assert.equal(c.count('users'), 2);
  assert.equal((await c.call('POST', '/api/me/identities/resident-identity/unlink', 'resident-sub')).response.status, 409);
  assert.equal(c.count('user_identities'), 2);
});

scenario('disabled write routes still require authentication', async c => {
  for (const path of ['/api/me/identities/link', '/api/communities/A/offerings/offering/commitments']) {
    assert.equal((await c.call('POST', path, null, {})).response.status, 401);
  }
  assert.equal(c.count('user_identities'), 2);
  assert.equal(c.count('batch_commitments'), 0);
});

scenario('legacy commitment rejection leaves no reservations, grouping, orders or audits', async c => {
  for (const body of [{ quantity: 10, idempotencyKey: 'legacy-attempt' }, { quantity: 70 }, {}]) {
    const r = await c.call('POST', '/api/communities/A/offerings/offering/commitments', 'resident-sub', body);
    assert.equal(r.response.status, 403);
    assert.equal(r.json.error.code, 'LEGACY_COMMITMENTS_DISABLED');
  }
  assert.equal(c.orphanCount(), 0);
  for (const table of ['batch_commitments', 'group_buy_batches', 'orders', 'audit_logs']) assert.equal(c.count(table), 0);
});

scenario('formal order forms order-backed grouping and finalizes/payments preserve minor units', async c => {
  const made = await c.call('POST', '/api/orders', 'resident-sub', {
    communityId: 'A', idempotencyKey: 'formal-order-key', items: [{ offeringId: 'offering', quantity: 10 }],
  });
  assert.equal(made.response.status, 201);
  const order = made.json.order;
  assert.equal(order.status, 'formed');
  assert.equal(order.items[0].unit_price_minor, 19900);
  assert.equal(order.estimatedTotalMinor, 199000);
  const commitment = c.db.database.prepare('SELECT * FROM batch_commitments').get();
  assert.equal(commitment.source_type, 'order_item');
  assert.equal(commitment.order_item_id, order.items[0].id);
  assert.equal(commitment.quantity, 10);
  assert.equal(c.orphanCount(), 0);
  const group = c.db.database.prepare('SELECT * FROM group_buy_batches').get();
  assert.equal(group.status, 'formed');
  assert.equal(group.committed_quantity, 10);
  const purchase = await c.call('POST', '/api/admin/communities/A/purchase-batches', 'admin-sub', {
    groupingIds: [group.id], idempotencyKey: 'formal-purchase-key',
  });
  assert.equal(purchase.response.status, 201);
  const path = `/api/admin/communities/A/purchase-batches/${purchase.json.purchaseBatch.id}`;
  assert.equal((await c.call('POST', `${path}/start`, 'admin-sub', {})).response.status, 200);
  const finalized = await c.call('POST', `${path}/finalize`, 'admin-sub', {
    idempotencyKey: 'formal-finalization-key', receiptId: null,
    results: [{ groupingId: group.id, purchasedQuantity: 7, actualUnitPriceMinor: 120 }],
  });
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.json));
  const allocation = c.db.database.prepare('SELECT * FROM purchase_allocations').get();
  assert.equal(allocation.fulfilled_quantity, 7);
  assert.equal(allocation.shortage_quantity, 3);
  assert.equal(allocation.final_amount_minor, 840);
  assert.equal(c.db.database.prepare('SELECT actual_unit_price_minor FROM purchase_group_results').get().actual_unit_price_minor, 120);
  assert.equal((await c.call('POST', `/api/admin/communities/A/pickups/${order.id}/confirm-payment`, 'admin-sub', {})).response.status, 200);
  const payment = c.db.database.prepare('SELECT * FROM cash_payments').get();
  assert.equal(payment.amount_minor, 840);
  assert.equal(formatMoney(payment.amount_minor), 'NT$8.40');
  assert.equal(c.orphanCount(), 0);
});

test('orphan diagnostic returns zero for fresh migrated DB', async () => {
  const db = await createPhase4BDatabase();
  try { assert.equal(db.database.prepare(orphanCountSql).get().count, 0); } finally { db.close(); }
});

scenario('orphan diagnostic detects intentional internal legacy fixtures without deleting them', async c => {
  const service = new GroupBuyBatchService(c.repositories);
  await service.commitQuantity('resident', 'A', 'offering', 1, 'historical-reservation');
  assert.equal(c.orphanCount(), 1);
  assert.equal(c.count('orders'), 0);
  assert.equal(c.count('batch_commitments'), 1);
});
