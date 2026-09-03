import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';
async function setup() {
  const db = await createPhase4BDatabase();
  seed(
    db,
    `INSERT INTO users(id)VALUES('pa'),('aa'),('ab'),('r');INSERT INTO user_profiles(user_id,display_name,phone)VALUES('pa','平台','0900000001'),('aa','甲管','0900000002'),('ab','乙管','0900000003'),('r','住戶','0900000004');INSERT INTO user_identities(id,user_id,provider,provider_user_id)VALUES('ipa','pa','chatgpt','pa'),('iaa','aa','chatgpt','aa'),('iab','ab','chatgpt','ab'),('ir','r','chatgpt','r');INSERT INTO communities(id,name,slug,status)VALUES('A','甲社區','a','active'),('B','乙社區','b','active'),('X','歷史社區','x','inactive');INSERT INTO community_members(id,user_id,community_id,role)VALUES('maa','aa','A','community_admin'),('mab','ab','B','community_admin'),('mr','r','A','resident'),('max','aa','X','community_admin');INSERT INTO platform_roles(user_id,role)VALUES('pa','platform_admin');INSERT INTO orders(id,user_id,community_id,status,currency,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot)VALUES('oa','r','A','submitted','TWD',1000,'ka','住戶','0900000004'),('ob','r','B','formed','TWD',2000,'kb','住戶','0900000004'),('ox','r','X','ready_for_pickup','TWD',3000,'kx','住戶','0900000004');INSERT INTO product_wishes(id,user_id,community_id,wish_text,status)VALUES('wa','r','A','白米','open'),('wb','r','B','食用油','open');`,
  );
  const repositories = new Repositories({ db });
  const app = createApplication(repositories, {
    async authenticate(req) {
      const id = req.headers.get('x-user');
      return id
        ? { provider: 'chatgpt', providerUserId: id, verified: true }
        : null;
    },
  });
  const call = async (path, user) => {
    const response = await app(
      new Request('http://local' + path, {
        headers: user ? { 'x-user': user } : {},
      }),
    );
    return { response, json: await response.json() };
  };
  return { db, repositories, call };
}
const cases = [
  [
    'platform admin 可取得所有 community summary',
    async (c) => {
      const r = await c.call('/api/admin/summary', 'pa');
      assert.equal(r.response.status, 200);
      assert.equal(r.json.manageableCommunities, 3);
    },
  ],
  [
    'community admin 只取得自己的 summary',
    async (c) => {
      const r = await c.call('/api/admin/summary', 'ab');
      assert.equal(r.json.manageableCommunities, 1);
      assert.equal(r.json.collecting, 0);
      assert.equal(r.json.groupedReady, 1);
    },
  ],
  [
    'community admin 查別的 community → 403',
    async (c) =>
      assert.equal(
        (await c.call('/api/admin/communities/B/summary', 'aa')).response
          .status,
        403,
      ),
  ],
  [
    'resident → 403',
    async (c) =>
      assert.equal(
        (await c.call('/api/admin/summary', 'r')).response.status,
        403,
      ),
  ],
  [
    'unknown community → 404',
    async (c) =>
      assert.equal(
        (await c.call('/api/admin/communities/missing/summary', 'pa')).response
          .status,
        404,
      ),
  ],
  [
    'admin order list scoped correctly',
    async (c) => {
      const r = await c.call('/api/admin/communities/A/orders', 'aa');
      assert.deepEqual(
        r.json.orders.map((x) => x.id),
        ['oa'],
      );
    },
  ],
  [
    'admin wishes scoped correctly',
    async (c) => {
      const r = await c.call('/api/admin/communities/A/wishes', 'aa');
      assert.deepEqual(
        r.json.wishes.map((x) => x.id),
        ['wa'],
      );
    },
  ],
  [
    'contact phone 不在未授權 response',
    async (c) => {
      const r = await c.call('/api/admin/communities/A/orders', 'ab');
      assert.equal(r.response.status, 403);
      assert.equal(JSON.stringify(r.json).includes('0900000004'), false);
    },
  ],
  [
    'inactive community historical admin data 可查看',
    async (c) => {
      const r = await c.call('/api/admin/communities/X/summary', 'aa');
      assert.equal(r.response.status, 200);
      assert.equal(r.json.summary.pendingPickup, 1);
    },
  ],
  [
    'inactive community 不重新開放會員操作',
    async (c) => {
      const r = await c.call('/api/communities', 'r');
      assert.equal(
        r.json.communities.some((x) => x.id === 'X'),
        false,
      );
    },
  ],
  [
    '500 不洩漏 SQL',
    async (c) => {
      c.repositories.operations.summaryGlobal = async () => {
        throw new Error('SELECT secret FROM tokens');
      };
      const r = await c.call('/api/admin/summary', 'pa');
      assert.equal(r.response.status, 500);
      assert.equal(JSON.stringify(r.json).includes('SELECT'), false);
    },
  ],
  [
    '500 不洩漏 stack',
    async (c) => {
      c.repositories.operations.summaryGlobal = async () => {
        throw new Error('boom');
      };
      const r = await c.call('/api/admin/summary', 'pa');
      assert.equal(JSON.stringify(r.json).includes('stack'), false);
    },
  ],
  [
    '500 不洩漏 secrets',
    async (c) => {
      c.repositories.operations.summaryGlobal = async () => {
        throw new Error('API_KEY=secret');
      };
      const r = await c.call('/api/admin/summary', 'pa');
      assert.equal(JSON.stringify(r.json).includes('secret'), false);
    },
  ],
  [
    'platform dashboard aggregation 正確',
    async (c) => {
      const r = await c.call('/api/admin/summary', 'pa');
      assert.deepEqual(
        [
          r.json.collecting,
          r.json.groupedReady,
          r.json.pendingPickup,
          r.json.unfinishedOrders,
        ],
        [1, 1, 1, 3],
      );
    },
  ],
  [
    'community admin aggregation 僅自己範圍',
    async (c) => {
      const r = await c.call('/api/admin/summary', 'aa');
      assert.deepEqual(
        [r.json.collecting, r.json.pendingPickup, r.json.unfinishedOrders],
        [1, 1, 2],
      );
    },
  ],
  [
    'platform admin aggregation 只呼叫一次 global aggregate',
    async (c) => {
      let calls = 0;
      const original = c.repositories.operations.summaryGlobal.bind(
        c.repositories.operations,
      );
      c.repositories.operations.summaryGlobal = async () => {
        calls++;
        return original();
      };
      await c.call('/api/admin/summary', 'pa');
      assert.equal(calls, 1);
    },
  ],
  [
    'community admin 多社區只呼叫一次 scoped aggregate',
    async (c) => {
    const scopes = [];
      const original = c.repositories.operations.summaryForCommunities.bind(
        c.repositories.operations,
      );
      c.repositories.operations.summaryForCommunities = async (ids) => {
        scopes.push(ids);
        return original(ids);
      };
      await c.call('/api/admin/summary', 'aa');
      assert.equal(scopes.length, 1);
      assert.deepEqual(new Set(scopes[0]), new Set(['A', 'X']));
    },
  ],
  [
    'empty scope 不查成全平台資料',
    async (c) => {
      let globalCalls = 0,
        scopedCalls = 0;
      c.repositories.operations.summaryGlobal = async () => {
        globalCalls++;
        return null;
      };
      c.repositories.operations.summaryForCommunities = async () => {
        scopedCalls++;
        return null;
      };
      const r = await c.call('/api/admin/summary', 'r');
      assert.equal(r.response.status, 403);
      assert.deepEqual([globalCalls, scopedCalls], [0, 0]);
    },
  ],
];
for (const [name, fn] of cases)
  test(name, async () => {
    const c = await setup();
    try {
      await fn(c);
    } finally {
      c.db.close();
    }
  });
