import assert from 'node:assert/strict';
import test from 'node:test';
import { Repositories } from '../../server/repositories/index.ts';
import { PurchaseBatchService } from '../../server/services/purchase-batches.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4BDatabase();
  seed(
    db,
    `INSERT INTO users(id)VALUES('a1'),('a2');INSERT INTO user_profiles(user_id,display_name)VALUES('a1','管一'),('a2','管二');INSERT INTO communities(id,name,slug)VALUES('A','A','a'),('B','B','b');INSERT INTO community_members(id,user_id,community_id,role)VALUES('m1','a1','A','community_admin'),('m2','a2','A','community_admin');INSERT INTO products(id,name,source_type,unit_label)VALUES('p','米','manual','包');INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('oa','A','p',100,30,1),('ob','B','p',100,30,1);INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity,formed_at)VALUES('G1','oa',1,'formed',30,30,CURRENT_TIMESTAMP),('G2','oa',2,'formed',30,30,CURRENT_TIMESTAMP),('GB','ob',1,'formed',30,30,CURRENT_TIMESTAMP);`,
  );
  const repositories = new Repositories({ db });
  return { db, repositories, service: new PurchaseBatchService(repositories) };
}

function count(db, table) {
  return Number(
    db.database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,
  );
}

test('Case A: one formed group has exactly one concurrent purchase batch owner', async () => {
  const c = await setup();
  try {
    const outcomes = await Promise.allSettled([
      c.service.create('a1', 'A', {
        groupingIds: ['G1'],
        idempotencyKey: 'owner-key-a',
      }),
      c.service.create('a2', 'A', {
        groupingIds: ['G1'],
        idempotencyKey: 'owner-key-b',
      }),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      outcomes.find((x) => x.status === 'rejected').reason.status,
      409,
    );
    assert.equal(count(c.db, 'purchase_batches'), 1);
    assert.equal(count(c.db, 'purchase_batch_groups'), 1);
    assert.equal(
      c.db.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_CREATED%'",
        )
        .get().count,
      1,
    );
  } finally {
    c.db.close();
  }
});

test('Case B: concurrent same idempotency key returns one logical purchase batch', async () => {
  const c = await setup();
  try {
    const input = { groupingIds: ['G1'], idempotencyKey: 'same-create-key' };
    const [a, b] = await Promise.all([
      c.service.create('a1', 'A', input),
      c.service.create('a1', 'A', input),
    ]);
    assert.equal(a.purchaseBatch.id, b.purchaseBatch.id);
    assert.equal(count(c.db, 'purchase_batches'), 1);
    assert.equal(count(c.db, 'purchase_batch_groups'), 1);
    assert.equal(
      c.db.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_CREATED%'",
        )
        .get().count,
      1,
    );
  } finally {
    c.db.close();
  }
});

test('same idempotency key with concurrent different selections has one winner and a conflict loser', async () => {
  const c = await setup();
  try {
    const outcomes = await Promise.allSettled([
      c.service.create('a1', 'A', {
        groupingIds: ['G1'],
        idempotencyKey: 'same-key-different-selection',
      }),
      c.service.create('a2', 'A', {
        groupingIds: ['G2'],
        idempotencyKey: 'same-key-different-selection',
      }),
    ]);
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled');
    const loser = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(winner);
    assert.equal(loser?.reason.status, 409);
    assert.equal(loser?.reason.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(count(c.db, 'purchase_batches'), 1);
    assert.equal(count(c.db, 'purchase_batch_groups'), 1);
    const winningGroupingId = c.db.database
      .prepare('SELECT group_buy_batch_id FROM purchase_batch_groups')
      .get().group_buy_batch_id;
    const losingGroupingId = winningGroupingId === 'G1' ? 'G2' : 'G1';
    assert.equal(
      c.db.database
        .prepare('SELECT status FROM group_buy_batches WHERE id=?')
        .get(losingGroupingId).status,
      'formed',
    );
    assert.equal(
      c.db.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_CREATED%'",
        )
        .get().count,
      1,
    );
  } finally {
    c.db.close();
  }
});

test('Case C: concurrent disjoint formed groups can each succeed', async () => {
  const c = await setup();
  try {
    const results = await Promise.all([
      c.service.create('a1', 'A', {
        groupingIds: ['G1'],
        idempotencyKey: 'disjoint-key-1',
      }),
      c.service.create('a2', 'A', {
        groupingIds: ['G2'],
        idempotencyKey: 'disjoint-key-2',
      }),
    ]);
    assert.equal(
      results.every((x) => x.created),
      true,
    );
    assert.equal(count(c.db, 'purchase_batches'), 2);
    assert.equal(count(c.db, 'purchase_batch_groups'), 2);
  } finally {
    c.db.close();
  }
});

test('Case D: concurrent start has one transition and one audit', async () => {
  const c = await setup();
  try {
    const created = await c.service.create('a1', 'A', {
      groupingIds: ['G1'],
      idempotencyKey: 'start-base-key',
    });
    const outcomes = await Promise.allSettled([
      c.service.start('a1', 'A', created.purchaseBatch.id),
      c.service.start('a2', 'A', created.purchaseBatch.id),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      outcomes.find((x) => x.status === 'rejected').reason.status,
      409,
    );
    assert.equal(
      c.db.database.prepare('SELECT status FROM purchase_batches').get().status,
      'purchasing',
    );
    assert.equal(
      c.db.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_STARTED%'",
        )
        .get().count,
      1,
    );
  } finally {
    c.db.close();
  }
});

test('Case E: multi-group conflict rolls back without orphan or partial membership', async () => {
  const c = await setup();
  try {
    await c.service.create('a1', 'A', {
      groupingIds: ['G2'],
      idempotencyKey: 'existing-owner',
    });
    await assert.rejects(
      c.service.create('a1', 'A', {
        groupingIds: ['G1', 'G2'],
        idempotencyKey: 'must-rollback',
      }),
      (error) => error.status === 409,
    );
    assert.equal(count(c.db, 'purchase_batches'), 1);
    assert.deepEqual(
      c.db.database
        .prepare('SELECT group_buy_batch_id FROM purchase_batch_groups')
        .all()
        .map((x) => x.group_buy_batch_id),
      ['G2'],
    );
    assert.equal(
      c.db.database
        .prepare("SELECT status FROM group_buy_batches WHERE id='G1'")
        .get().status,
      'formed',
    );
    assert.equal(
      c.db.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_CREATED%'",
        )
        .get().count,
      1,
    );
  } finally {
    c.db.close();
  }
});

test('Case F: cross-community groups are rejected without persistence or audit', async () => {
  const c = await setup();
  try {
    await assert.rejects(
      c.service.create('a1', 'A', {
        groupingIds: ['G1', 'GB'],
        idempotencyKey: 'cross-community',
      }),
      (error) => error.status === 404,
    );
    assert.equal(count(c.db, 'purchase_batches'), 0);
    assert.equal(count(c.db, 'purchase_batch_groups'), 0);
    assert.equal(count(c.db, 'audit_logs'), 0);
  } finally {
    c.db.close();
  }
});
