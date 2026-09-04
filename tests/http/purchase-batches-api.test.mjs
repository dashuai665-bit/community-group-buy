import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4BDatabase();
  seed(
    db,
    `INSERT INTO users(id)VALUES('pa'),('aa'),('ab'),('r');INSERT INTO user_profiles(user_id,display_name,phone)VALUES('pa','平台','0900000001'),('aa','A管','0900000002'),('ab','B管','0900000003'),('r','住戶','0900000004');INSERT INTO user_identities(id,user_id,provider,provider_user_id)VALUES('ipa','pa','chatgpt','pa'),('iaa','aa','chatgpt','aa'),('iab','ab','chatgpt','ab'),('ir','r','chatgpt','r');INSERT INTO communities(id,name,slug,status)VALUES('A','A社區','a','active'),('B','B社區','b','active'),('X','歷史社區','x','inactive');INSERT INTO community_members(id,user_id,community_id,role)VALUES('maa','aa','A','community_admin'),('mab','ab','B','community_admin'),('mr','r','A','resident'),('max','aa','X','community_admin');INSERT INTO platform_roles(user_id,role)VALUES('pa','platform_admin');INSERT INTO products(id,name,source_type,unit_label)VALUES('p','白米','manual','包');INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('oa','A','p',100,30,1),('ob','B','p',200,30,1),('ox','X','p',90,30,1);INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity,formed_at)VALUES('G1','oa',1,'formed',30,30,CURRENT_TIMESTAMP),('G2','oa',2,'formed',30,30,CURRENT_TIMESTAMP),('OPEN','oa',3,'open',30,1,NULL),('GB','ob',1,'formed',30,30,CURRENT_TIMESTAMP),('GX','ox',1,'formed',30,30,CURRENT_TIMESTAMP);INSERT INTO orders(id,user_id,community_id,status,currency,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot)VALUES('order','r','A','formed','TWD',3000,'order-key','住戶','0900000004');INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor)VALUES('item','order','oa','p','白米','包',100,30,3000);INSERT INTO batch_commitments(id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)VALUES('commit','request','G1',30,'order_item','item','item','active');`,
  );
  const repositories = new Repositories({ db });
  const app = createApplication(repositories, {
    async authenticate(request) {
      const id = request.headers.get('x-user');
      return id
        ? { provider: 'chatgpt', providerUserId: id, verified: true }
        : null;
    },
  });
  const call = async (method, path, user, body) => {
    const headers = new Headers();
    if (user) headers.set('x-user', user);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await app(new Request(`http://local${path}`, init));
    return { response, json: await response.json() };
  };
  return { db, repositories, call };
}

const createBody = (groups = ['G1'], key = 'purchase-key-01') => ({
  groupingIds: groups,
  idempotencyKey: key,
  createdBy: 'r',
  status: 'purchasing',
});

const cases = [
  [
    'platform admin and own community admin can list',
    async (c) => {
      assert.equal(
        (await c.call('GET', '/api/admin/communities/A/purchase-batches', 'pa'))
          .response.status,
        200,
      );
      assert.equal(
        (await c.call('GET', '/api/admin/communities/A/purchase-batches', 'aa'))
          .response.status,
        200,
      );
    },
  ],
  [
    'other community admin and resident receive 403',
    async (c) => {
      assert.equal(
        (await c.call('GET', '/api/admin/communities/A/purchase-batches', 'ab'))
          .response.status,
        403,
      );
      assert.equal(
        (await c.call('GET', '/api/admin/communities/A/purchase-batches', 'r'))
          .response.status,
        403,
      );
    },
  ],
  [
    'unknown community and purchase batch return 404',
    async (c) => {
      assert.equal(
        (
          await c.call(
            'GET',
            '/api/admin/communities/missing/purchase-batches',
            'pa',
          )
        ).response.status,
        404,
      );
      assert.equal(
        (
          await c.call(
            'GET',
            '/api/admin/communities/A/purchase-batches/missing',
            'aa',
          )
        ).response.status,
        404,
      );
    },
  ],
  [
    'create one and multiple formed groups succeeds with server actor and ready status',
    async (c) => {
      const result = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(['G1', 'G2']),
      );
      assert.equal(result.response.status, 201);
      assert.equal(result.json.purchaseBatch.status, 'ready');
      assert.equal(result.json.purchaseBatch.created_by_user_id, 'aa');
      assert.equal(result.json.purchaseBatch.groupCount, 2);
    },
  ],
  [
    'empty and duplicate grouping lists return 400',
    async (c) => {
      assert.equal(
        (
          await c.call(
            'POST',
            '/api/admin/communities/A/purchase-batches',
            'aa',
            createBody([]),
          )
        ).response.status,
        400,
      );
      assert.equal(
        (
          await c.call(
            'POST',
            '/api/admin/communities/A/purchase-batches',
            'aa',
            createBody(['G1', 'G1']),
          )
        ).response.status,
        400,
      );
    },
  ],
  [
    'malformed idempotency key returns 400',
    async (c) =>
      assert.equal(
        (
          await c.call(
            'POST',
            '/api/admin/communities/A/purchase-batches',
            'aa',
            createBody(['G1'], 'bad'),
          )
        ).response.status,
        400,
      ),
  ],
  [
    'open, assigned, and cross-community grouping are rejected',
    async (c) => {
      assert.equal(
        (
          await c.call(
            'POST',
            '/api/admin/communities/A/purchase-batches',
            'aa',
            createBody(['OPEN']),
          )
        ).response.status,
        409,
      );
      await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(['G1'], 'first-owner'),
      );
      assert.equal(
        (
          await c.call(
            'POST',
            '/api/admin/communities/A/purchase-batches',
            'aa',
            createBody(['G1'], 'second-owner'),
          )
        ).response.status,
        409,
      );
      assert.equal(
        (
          await c.call(
            'POST',
            '/api/admin/communities/A/purchase-batches',
            'pa',
            createBody(['G2', 'GB'], 'cross-key'),
          )
        ).response.status,
        404,
      );
    },
  ],
  [
    'start succeeds once and duplicate start conflicts',
    async (c) => {
      const made = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      const id = made.json.purchaseBatch.id;
      const started = await c.call(
        'POST',
        `/api/admin/communities/A/purchase-batches/${id}/start`,
        'aa',
        {},
      );
      assert.equal(started.json.purchaseBatch.status, 'purchasing');
      assert.equal(
        (
          await c.call(
            'POST',
            `/api/admin/communities/A/purchase-batches/${id}/start`,
            'aa',
            {},
          )
        ).response.status,
        409,
      );
    },
  ],
  [
    'create and start audits are singular and omit secrets',
    async (c) => {
      const made = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      await c.call(
        'POST',
        `/api/admin/communities/A/purchase-batches/${made.json.purchaseBatch.id}/start`,
        'aa',
        {},
      );
      const raw = JSON.stringify(await c.repositories.audits.list());
      assert.equal((raw.match(/PURCHASE_BATCH_CREATED/g) ?? []).length, 1);
      assert.equal((raw.match(/PURCHASE_BATCH_STARTED/g) ?? []).length, 1);
      assert.equal(/0900000004|token|authorization/i.test(raw), false);
    },
  ],
  [
    'idempotent retry returns same batch without duplicate membership or audit',
    async (c) => {
      const a = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      const b = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      assert.equal(a.json.purchaseBatch.id, b.json.purchaseBatch.id);
      assert.equal(b.response.status, 200);
      assert.equal(
        c.db.database
          .prepare('SELECT COUNT(*) count FROM purchase_batch_groups')
          .get().count,
        1,
      );
      assert.equal(
        c.db.database
          .prepare(
            "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_CREATED%'",
          )
          .get().count,
        1,
      );
    },
  ],
  [
    'idempotent grouping selection comparison uses set semantics',
    async (c) => {
      const first = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(['G1', 'G2'], 'set-semantics-key'),
      );
      const retry = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(['G2', 'G1'], 'set-semantics-key'),
      );
      assert.equal(retry.response.status, 200);
      assert.equal(retry.json.created, false);
      assert.equal(first.json.purchaseBatch.id, retry.json.purchaseBatch.id);
      assert.equal(
        c.db.database
          .prepare('SELECT COUNT(*) count FROM purchase_batch_groups')
          .get().count,
        2,
      );
      assert.equal(
        c.db.database
          .prepare(
            "SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_CREATED%'",
          )
          .get().count,
        1,
      );
    },
  ],
  [
    'same idempotency key with a different grouping selection returns conflict',
    async (c) => {
      const original = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(['G1'], 'payload-conflict-key'),
      );
      const conflict = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(['G2'], 'payload-conflict-key'),
      );
      assert.equal(conflict.response.status, 409);
      assert.equal(conflict.json.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(
        c.db.database
          .prepare('SELECT COUNT(*) count FROM purchase_batches')
          .get().count,
        1,
      );
      assert.equal(
        c.db.database
          .prepare('SELECT purchase_batch_id FROM purchase_batch_groups')
          .get().purchase_batch_id,
        original.json.purchaseBatch.id,
      );
      assert.equal(
        c.db.database
          .prepare("SELECT status FROM group_buy_batches WHERE id='G2'")
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
    },
  ],
  [
    'inactive community historical create and start remain allowed',
    async (c) => {
      const made = await c.call(
        'POST',
        '/api/admin/communities/X/purchase-batches',
        'aa',
        createBody(['GX'], 'inactive-key'),
      );
      assert.equal(made.response.status, 201);
      assert.equal(
        (
          await c.call(
            'POST',
            `/api/admin/communities/X/purchase-batches/${made.json.purchaseBatch.id}/start`,
            'aa',
            {},
          )
        ).response.status,
        200,
      );
    },
  ],
  [
    'purchase batch API never exposes contact phone',
    async (c) => {
      await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      const listed = await c.call(
        'GET',
        '/api/admin/communities/A/purchase-batches',
        'aa',
      );
      assert.equal(JSON.stringify(listed.json).includes('0900000004'), false);
    },
  ],
  [
    'estimated total uses order item snapshot after offering price changes',
    async (c) => {
      c.db.database
        .prepare(
          "UPDATE community_product_offerings SET price_minor=999 WHERE id='oa'",
        )
        .run();
      const made = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      assert.equal(made.json.purchaseBatch.estimatedTotalMinor, 3000);
      assert.equal(
        made.json.purchaseBatch.groups[0].estimated_amount_minor,
        3000,
      );
    },
  ],
  [
    'unexpected repository failure is a safe 500',
    async (c) => {
      c.repositories.batch = async () => {
        throw new Error('SELECT secret token authorization stack');
      };
      const result = await c.call(
        'POST',
        '/api/admin/communities/A/purchase-batches',
        'aa',
        createBody(),
      );
      assert.equal(result.response.status, 500);
      assert.equal(
        /SELECT|secret|token|authorization|stack/i.test(
          JSON.stringify(result.json),
        ),
        false,
      );
    },
  ],
];

for (const [name, scenario] of cases)
  test(name, async () => {
    const c = await setup();
    try {
      await scenario(c);
    } finally {
      c.db.close();
    }
  });
