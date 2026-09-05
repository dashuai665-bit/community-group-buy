import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4BDatabase();
  seed(db, `INSERT INTO users(id)VALUES('pa'),('admin'),('other'),('resident');
    INSERT INTO user_profiles(user_id,display_name)VALUES('pa','平台'),('admin','社區管理員'),('other','其他管理員'),('resident','住戶');
    INSERT INTO user_identities(id,user_id,provider,provider_user_id)VALUES('ipa','pa','chatgpt','pa'),('ia','admin','chatgpt','admin'),('io','other','chatgpt','other'),('ir','resident','chatgpt','resident');
    INSERT INTO communities(id,name,slug)VALUES('A','甲社區','a'),('B','乙社區','b');
    INSERT INTO community_members(id,user_id,community_id,role)VALUES('ma','admin','A','community_admin'),('mo','other','B','community_admin'),('mr','resident','A','resident');
    INSERT INTO platform_roles(user_id,role)VALUES('pa','platform_admin');
    INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id,metadata,created_at)VALUES
      ('a1','admin','A','batch_formed','group_buy_batch','g1','{"event":"MANUAL_FORMED","reason":"安全原因","phone":"0900000000","storageKey":"secret"}','2026-01-01 00:00:00'),
      ('a2','admin','A','pickup_ready','order','o1','{"event":"CASH_PAYMENT_CONFIRMED","amountMinor":840,"token":"secret"}','2026-01-02 00:00:00'),
      ('b1','other','B','community_join','community','B',NULL,'2026-01-03 00:00:00');`);
  const app = createApplication(new Repositories({ db }), { async authenticate(request) {
    const id = request.headers.get('x-user');
    return id ? { provider: 'chatgpt', providerUserId: id, verified: true } : null;
  }});
  async function call(path, user) {
    const response = await app(new Request(`http://local${path}`, { headers: user ? { 'x-user': user } : {} }));
    return { response, json: await response.json() };
  }
  return { db, call };
}

test('community audit is scoped, normalized, newest-first and sanitized', async () => {
  const c = await setup();
  const result = await c.call('/api/admin/communities/A/audit-logs?limit=1&page=1', 'admin');
  assert.equal(result.response.status, 200);
  assert.equal(result.json.total, 2);
  assert.equal(result.json.auditLogs[0].event, 'CASH_PAYMENT_CONFIRMED');
  assert.equal(JSON.stringify(result.json).includes('0900000000'), false);
  assert.equal(JSON.stringify(result.json).includes('secret'), false);
  const filtered = await c.call('/api/admin/communities/A/audit-logs?event=MANUAL_FORMED', 'admin');
  assert.deepEqual(filtered.json.auditLogs.map((row) => row.id), ['a1']);
  c.db.close();
});

test('audit authorization blocks resident and cross-community admin', async () => {
  const c = await setup();
  assert.equal((await c.call('/api/admin/communities/A/audit-logs', 'resident')).response.status, 403);
  assert.equal((await c.call('/api/admin/communities/A/audit-logs', 'other')).response.status, 403);
  assert.equal((await c.call('/api/admin/communities/missing/audit-logs', 'admin')).response.status, 404);
  c.db.close();
});

test('platform audit supports global and community scopes with bounded pagination', async () => {
  const c = await setup();
  assert.equal((await c.call('/api/admin/audit-logs', 'admin')).response.status, 403);
  const global = await c.call('/api/admin/audit-logs?limit=50&page=1', 'pa');
  assert.equal(global.json.total, 3);
  const scoped = await c.call('/api/admin/audit-logs?communityId=A&event=CASH_PAYMENT_CONFIRMED', 'pa');
  assert.deepEqual(scoped.json.auditLogs.map((row) => row.id), ['a2']);
  assert.equal((await c.call('/api/admin/audit-logs?limit=101', 'pa')).response.status, 422);
  c.db.close();
});
