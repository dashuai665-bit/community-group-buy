import assert from 'node:assert/strict';
import test from 'node:test';
import { Repositories } from '../../server/repositories/index.ts';
import { CommunityMembershipService, IdentityService } from '../../server/services/index.ts';
import { createPhase3Database, seed } from '../helpers/sqlite-database.mjs';

function count(db, table) { return db.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count; }

test('repository CRUD 使用 prepared binding，migration 與 foreign keys 正常', async () => {
  const db = await createPhase3Database();
  const repositories = new Repositories({ db });
  await repositories.batch([
    repositories.users.insertStatement('user-1'),
    repositories.profiles.insertStatement('user-1', 'person@example.test'),
  ]);
  assert.equal((await repositories.users.findById('user-1')).status, 'active');
  assert.equal((await repositories.profiles.findByUserId('user-1')).email, 'person@example.test');
  assert.throws(() => db.exec("INSERT INTO user_profiles (user_id) VALUES ('missing')"), /FOREIGN KEY/);
  db.close();
});

test('first-login provisioning commit，existing identity 回傳同一 users.id', async () => {
  const db = await createPhase3Database();
  const service = new IdentityService(new Repositories({ db }));
  const identity = { provider: 'google', providerUserId: 'subject-1', verified: true, email: 'same@example.test' };
  const first = await service.resolveAppUser(identity);
  const second = await service.resolveAppUser(identity);
  assert.equal(first, second);
  assert.equal(count(db, 'users'), 1);
  assert.equal(count(db, 'user_profiles'), 1);
  assert.equal(count(db, 'user_identities'), 1);
  db.close();
});

test('provisioning 中途失敗會 rollback，不留下 user/profile', async () => {
  const db = await createPhase3Database();
  const repositories = new Repositories({ db });
  repositories.profiles.insertStatement = () => db.prepare('INSERT INTO table_that_does_not_exist VALUES (?)').bind('fail');
  await assert.rejects(() => new IdentityService(repositories).resolveAppUser({ provider: 'google', providerUserId: 'rollback-subject', verified: true }));
  assert.equal(count(db, 'users'), 0);
  assert.equal(count(db, 'user_profiles'), 0);
  assert.equal(count(db, 'user_identities'), 0);
  db.close();
});

test('相同 email 不 merge；provider identity unique conflict 受 DB 約束', async () => {
  const db = await createPhase3Database();
  const service = new IdentityService(new Repositories({ db }));
  const a = await service.resolveAppUser({ provider: 'google', providerUserId: 'google-a', verified: true, email: 'same@example.test' });
  const b = await service.resolveAppUser({ provider: 'email', providerUserId: 'email-b', verified: true, email: 'same@example.test' });
  assert.notEqual(a, b);
  assert.equal(count(db, 'users'), 2);
  db.close();
});

test('join + audit 同批 commit；audit 失敗則 membership rollback', async () => {
  const db = await createPhase3Database();
  seed(db, "INSERT INTO users (id) VALUES ('user-1'); INSERT INTO user_profiles (user_id) VALUES ('user-1'); INSERT INTO communities (id,name,slug) VALUES ('A','A','a'),('B','B','b')");
  const repositories = new Repositories({ db });
  const service = new CommunityMembershipService(repositories);
  await service.join('user-1', 'A');
  assert.equal(count(db, 'community_members'), 1);
  assert.equal(count(db, 'audit_logs'), 1);
  repositories.audits.insertStatement = () => db.prepare('INSERT INTO missing_audit VALUES (1)');
  await assert.rejects(() => service.join('user-1', 'B'));
  assert.equal(count(db, 'community_members'), 1);
  db.close();
});

test('leave default 會 atomic reassignment + audit；失敗則完整 rollback', async () => {
  const db = await createPhase3Database();
  seed(db, `INSERT INTO users (id) VALUES ('user-1');
    INSERT INTO communities (id,name,slug) VALUES ('A','A','a'),('B','B','b');
    INSERT INTO community_members (id,user_id,community_id) VALUES ('m-a','user-1','A'),('m-b','user-1','B');
    INSERT INTO user_profiles (user_id,default_community_id) VALUES ('user-1','A')`);
  const repositories = new Repositories({ db });
  const service = new CommunityMembershipService(repositories);
  await service.leave('user-1', 'A');
  assert.equal((await repositories.profiles.findByUserId('user-1')).default_community_id, 'B');
  assert.equal((await repositories.members.find('user-1', 'A')).status, 'inactive');
  assert.equal(count(db, 'audit_logs'), 1);

  seed(db, "UPDATE community_members SET status='active' WHERE community_id='A'; UPDATE user_profiles SET default_community_id='A' WHERE user_id='user-1'");
  repositories.audits.insertStatement = () => db.prepare('INSERT INTO missing_audit VALUES (1)');
  await assert.rejects(() => service.leave('user-1', 'A'));
  assert.equal((await repositories.profiles.findByUserId('user-1')).default_community_id, 'A');
  assert.equal((await repositories.members.find('user-1', 'A')).status, 'active');
  db.close();
});

test('非最後 admin 可離開且 platform role 不受 community leave 影響', async () => {
  const db = await createPhase3Database();
  seed(db, `INSERT INTO users (id) VALUES ('admin-1'),('admin-2'),('platform');
    INSERT INTO user_profiles (user_id) VALUES ('admin-1'),('admin-2'),('platform');
    INSERT INTO communities (id,name,slug) VALUES ('A','A','a');
    INSERT INTO community_members (id,user_id,community_id,role) VALUES ('m1','admin-1','A','community_admin'),('m2','admin-2','A','community_admin'),('mp','platform','A','resident');
    INSERT INTO platform_roles (user_id,role) VALUES ('platform','platform_admin')`);
  const repositories = new Repositories({ db });
  const service = new CommunityMembershipService(repositories);
  await service.leave('admin-1', 'A');
  await service.leave('platform', 'A');
  assert.equal((await repositories.members.find('admin-1', 'A')).status, 'inactive');
  assert.equal(await repositories.platformRoles.isPlatformAdmin('platform'), true);
  db.close();
});

test('identity link/unlink 與 audit persistence atomic', async () => {
  const db = await createPhase3Database();
  seed(db, `INSERT INTO users (id) VALUES ('user-1');
    INSERT INTO user_profiles (user_id) VALUES ('user-1');
    INSERT INTO user_identities (id,user_id,provider,provider_user_id,verified) VALUES ('base','user-1','chatgpt','base-sub','true')`);
  const repositories = new Repositories({ db });
  const service = new IdentityService(repositories);
  await service.linkIdentityToAuthenticatedUser('user-1', {
    provider: 'email', providerUserId: 'person@example.test', verified: true,
  });
  const linked = await repositories.identities.find('email', 'person@example.test');
  await service.unlinkIdentity('user-1', linked.id);
  const actions = (await repositories.audits.list()).map((row) => row.action_type);
  assert.deepEqual(actions.toSorted((left, right) => left.localeCompare(right)), ['identity_link', 'identity_unlink']);
  assert.equal(await repositories.identities.find('email', 'person@example.test'), null);
  db.close();
});
