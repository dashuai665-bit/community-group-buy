import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase3Database, seed } from '../helpers/sqlite-database.mjs';

const identities = {
  active: { provider: 'chatgpt', providerUserId: 'active-sub', verified: true },
  suspended: { provider: 'chatgpt', providerUserId: 'suspended-sub', verified: true },
  deleted: { provider: 'chatgpt', providerUserId: 'deleted-sub', verified: true },
  adminA: { provider: 'chatgpt', providerUserId: 'admin-a-sub', verified: true },
  adminB: { provider: 'chatgpt', providerUserId: 'admin-b-sub', verified: true },
  platform: { provider: 'chatgpt', providerUserId: 'platform-sub', verified: true },
  target: { provider: 'chatgpt', providerUserId: 'target-sub', verified: true },
};

async function setup() {
  const db = await createPhase3Database();
  seed(db, `
    INSERT INTO users (id,status) VALUES ('active','active'),('suspended','suspended'),('deleted','deleted'),('admin-a','active'),('admin-b','active'),('platform','active'),('target','active');
    INSERT INTO user_profiles (user_id,display_name,phone,phone_verified,email) VALUES
      ('active','住戶','0911111111','true','resident@example.test'),
      ('suspended','停權','0922222222','false',NULL),('deleted','刪除','0933333333','false',NULL),
      ('admin-a','A 管理員','0944444444','true',NULL),('admin-b','B 管理員','0955555555','true',NULL),
      ('platform','平台管理員','0966666666','true',NULL),('target','目標住戶','0977777777','true','target@example.test');
    INSERT INTO communities (id,name,slug,status,join_policy) VALUES
      ('A','A 社區','a','active','open'),('B','B 社區','b','active','open'),
      ('inactive','停用社區','inactive','inactive','open'),
      ('approval','審核社區','approval','active','approval_required'),
      ('invite','邀請社區','invite','active','invite_only');
    INSERT INTO community_members (id,user_id,community_id,role,status) VALUES
      ('m-active-a','active','A','resident','active'),
      ('m-admin-a','admin-a','A','community_admin','active'),
      ('m-admin-b','admin-b','B','community_admin','active'),
      ('m-target-a','target','A','resident','active');
    UPDATE user_profiles SET default_community_id='A' WHERE user_id IN ('active','admin-a','target');
    UPDATE user_profiles SET default_community_id='B' WHERE user_id='admin-b';
    INSERT INTO platform_roles (user_id,role) VALUES ('platform','platform_admin');
    INSERT INTO user_identities (id,user_id,provider,provider_user_id,verified) VALUES
      ('i-active','active','chatgpt','active-sub','true'),('i-suspended','suspended','chatgpt','suspended-sub','true'),
      ('i-deleted','deleted','chatgpt','deleted-sub','true'),('i-admin-a','admin-a','chatgpt','admin-a-sub','true'),
      ('i-admin-b','admin-b','chatgpt','admin-b-sub','true'),('i-platform','platform','chatgpt','platform-sub','true'),
      ('i-target','target','chatgpt','target-sub','true');
  `);
  const repositories = new Repositories({ db });
  const authentication = { async authenticate(request) {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    return token ? identities[token] ?? null : null;
  } };
  return { db, repositories, handle: createApplication(repositories, authentication) };
}

async function call(handle, path, { method = 'GET', token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handle(new Request(`http://local.test${path}`, init));
}

function scenario(name, action) {
  test(name, async () => {
    const context = await setup();
    try { await action(context); } finally { context.db.close(); }
  });
}

scenario('01 anonymous GET active communities → 200', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities')).status, 200);
});
scenario('02 inactive communities 不出現在 public list', async ({ handle }) => {
  const payload = await (await call(handle, '/api/communities')).json();
  assert.equal(payload.communities.some((item) => item.id === 'inactive'), false);
});
scenario('03 public payload 無 PII/identity metadata', async ({ handle }) => {
  const text = JSON.stringify(await (await call(handle, '/api/communities')).json());
  assert.doesNotMatch(text, /phone|email|identity|metadata/i);
});
scenario('04 anonymous join → 401', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities/B/join', { method: 'POST' })).status, 401);
});
scenario('05 active user join open → 201', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities/B/join', { method: 'POST', token: 'active' })).status, 201);
});
scenario('06 duplicate join → idempotent 200', async ({ handle }) => {
  const response = await call(handle, '/api/communities/A/join', { method: 'POST', token: 'active' });
  assert.equal(response.status, 200); assert.equal((await response.json()).created, false);
});
scenario('07 inactive community join → reject', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities/inactive/join', { method: 'POST', token: 'active' })).status, 404);
});
scenario('08 approval_required 不直接加入', async ({ handle, repositories }) => {
  assert.equal((await call(handle, '/api/communities/approval/join', { method: 'POST', token: 'active' })).status, 409);
  assert.equal(await repositories.members.find('active', 'approval'), null);
});
scenario('09 invite_only 不直接加入', async ({ handle, repositories }) => {
  assert.equal((await call(handle, '/api/communities/invite/join', { method: 'POST', token: 'active' })).status, 403);
  assert.equal(await repositories.members.find('active', 'invite'), null);
});
scenario('10 my communities 只回自己的 active memberships', async ({ handle }) => {
  const payload = await (await call(handle, '/api/me/communities', { token: 'active' })).json();
  assert.deepEqual(payload.memberships.map((item) => item.community.id), ['A']);
});
scenario('11 set default without membership → 422', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/default-community', { method: 'PUT', token: 'active', body: { communityId: 'B' } })).status, 422);
});
scenario('12 set inactive default → 422', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/default-community', { method: 'PUT', token: 'active', body: { communityId: 'inactive' } })).status, 422);
});
scenario('13 valid default → success', async ({ handle, repositories }) => {
  await call(handle, '/api/communities/B/join', { method: 'POST', token: 'active' });
  assert.equal((await call(handle, '/api/me/default-community', { method: 'PUT', token: 'active', body: { communityId: 'B' } })).status, 200);
  assert.equal((await repositories.profiles.findByUserId('active')).default_community_id, 'B');
});
scenario('14 browsing switch 不改 default', async ({ repositories }) => {
  const before = (await repositories.profiles.findByUserId('active')).default_community_id;
  const browsing = 'B';
  assert.equal(browsing, 'B'); assert.equal((await repositories.profiles.findByUserId('active')).default_community_id, before);
});
scenario('15 leave non-default → success', async ({ handle, repositories }) => {
  await call(handle, '/api/communities/B/join', { method: 'POST', token: 'active' });
  assert.equal((await call(handle, '/api/communities/B/leave', { method: 'POST', token: 'active' })).status, 200);
  assert.equal((await repositories.profiles.findByUserId('active')).default_community_id, 'A');
});
scenario('16 leave default → reassignment', async ({ handle, repositories }) => {
  await call(handle, '/api/communities/B/join', { method: 'POST', token: 'active' });
  await call(handle, '/api/communities/A/leave', { method: 'POST', token: 'active' });
  assert.equal((await repositories.profiles.findByUserId('active')).default_community_id, 'B');
});
scenario('17 leave last membership → default null', async ({ handle, repositories }) => {
  await call(handle, '/api/communities/A/leave', { method: 'POST', token: 'active' });
  assert.equal((await repositories.profiles.findByUserId('active')).default_community_id, null);
});
scenario('18 own community admin contact → success', async ({ handle }) => {
  assert.equal((await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'adminA' })).status, 200);
});
scenario('19 other community admin → 403', async ({ handle }) => {
  assert.equal((await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'adminB' })).status, 403);
});
scenario('20 platform admin cross-community → success', async ({ handle }) => {
  assert.equal((await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'platform' })).status, 200);
});
scenario('21 resident admin endpoint → 403', async ({ handle }) => {
  assert.equal((await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'active' })).status, 403);
});
scenario('22 admin contact payload 最小化', async ({ handle }) => {
  const payload = await (await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'adminA' })).json();
  assert.deepEqual(Object.keys(payload.contact).sort(), ['displayName', 'phone', 'phoneVerified']);
});
scenario('23 contact target 必須屬於該 community', async ({ handle }) => {
  assert.equal((await call(handle, '/api/admin/communities/A/members/admin-b/contact', { token: 'adminA' })).status, 404);
});
scenario('24 last community admin 不可 leave', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities/A/leave', { method: 'POST', token: 'adminA' })).status, 409);
});
scenario('25 existing external identity → same users.id', async ({ handle, repositories }) => {
  await call(handle, '/api/me/communities', { token: 'active' });
  assert.equal((await repositories.identities.find('chatgpt', 'active-sub')).user_id, 'active');
});
scenario('26 same email different provider identity → no merge', async ({ handle, repositories }) => {
  identities.newGoogle = { provider: 'google', providerUserId: 'new-google', verified: true, email: 'resident@example.test' };
  await call(handle, '/api/me/communities', { token: 'newGoogle' });
  assert.notEqual((await repositories.identities.find('google', 'new-google')).user_id, 'active');
});
scenario('27 same phone text → no merge', async ({ handle, repositories }) => {
  identities.newPhone = { provider: 'phone', providerUserId: 'new-phone', verified: true };
  await call(handle, '/api/me/communities', { token: 'newPhone' });
  const newUser = (await repositories.identities.find('phone', 'new-phone')).user_id;
  await call(handle, '/api/me/profile/phone', { method: 'PUT', token: 'newPhone', body: { phone: '0911111111' } });
  assert.notEqual(newUser, 'active');
});
scenario('28 link identity requires auth', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/identities/link', { method: 'POST', body: { provider: 'google', providerUserId: 'new-id', verified: true } })).status, 401);
});
scenario('29 identity linking is disabled even for already-linked subjects', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/identities/link', { method: 'POST', token: 'active', body: { provider: 'chatgpt', providerUserId: 'target-sub', verified: true } })).status, 403);
});
scenario('30 cannot unlink another user identity', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/identities/i-target/unlink', { method: 'POST', token: 'active' })).status, 403);
});
scenario('31 cannot unlink last identity', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/identities/i-active/unlink', { method: 'POST', token: 'active' })).status, 409);
});
scenario('32 changing verified phone resets phone_verified', async ({ handle, repositories }) => {
  assert.equal((await call(handle, '/api/me/profile/phone', { method: 'PUT', token: 'active', body: { phone: '0987654321' } })).status, 200);
  assert.equal((await repositories.profiles.findByUserId('active')).phone_verified, 'false');
});
scenario('33 suspended user protected mutation → 403', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities/B/join', { method: 'POST', token: 'suspended' })).status, 403);
});
scenario('34 deleted user protected mutation → 403', async ({ handle }) => {
  assert.equal((await call(handle, '/api/communities/B/join', { method: 'POST', token: 'deleted' })).status, 403);
});
scenario('35 mutations 與 contact access 產生 audit logs', async ({ handle, repositories }) => {
  await call(handle, '/api/communities/B/join', { method: 'POST', token: 'active' });
  await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'adminA' });
  const actions = (await repositories.audits.list()).map((row) => row.action_type);
  assert.deepEqual(actions.sort(), ['admin_member_contact_access', 'community_join']);
});
scenario('36 audit metadata 無 raw phone/token/OTP，500 response 無 internal detail', async ({ handle, repositories }) => {
  await call(handle, '/api/admin/communities/A/members/target/contact', { token: 'adminA' });
  const text = JSON.stringify(await repositories.audits.list());
  assert.doesNotMatch(text, /0977777777|token|otp/i);
  repositories.communities.listActive = async () => { throw new Error('SQL secret schema users'); };
  const response = await call(handle, '/api/communities');
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /SQL|schema|secret|stack/i);
});
scenario('37 display name can be completed after provisioning', async ({ handle, repositories }) => {
  identities.newMember = { provider: 'chatgpt', providerUserId: 'new-member-sub', verified: true };
  await call(handle, '/api/me/profile', { token: 'newMember' });
  const identity = await repositories.identities.find('chatgpt', 'new-member-sub');
  assert.equal((await repositories.profiles.findByUserId(identity.user_id)).display_name, null);
  const response = await call(handle, '/api/me/profile/display-name', { method: 'PUT', token: 'newMember', body: { displayName: '新會員' } });
  assert.equal(response.status, 200);
  assert.equal((await repositories.profiles.findByUserId(identity.user_id)).display_name, '新會員');
});
scenario('38 display name runtime validation rejects blank values', async ({ handle }) => {
  assert.equal((await call(handle, '/api/me/profile/display-name', { method: 'PUT', token: 'active', body: { displayName: '   ' } })).status, 422);
});
scenario('39 platform admin receives all communities in admin landing API', async ({ handle }) => {
  const response = await call(handle, '/api/admin/communities', { token: 'platform' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.isPlatformAdmin, true);
  assert.equal(payload.communities.some((community) => community.id === 'A'), true);
  assert.equal(payload.communities.some((community) => community.id === 'B'), true);
  assert.equal(payload.communities.some((community) => community.id === 'inactive'), true);
});
scenario('40 community admin admin landing API stays scoped to own communities', async ({ handle }) => {
  const response = await call(handle, '/api/admin/communities', { token: 'adminA' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.isPlatformAdmin, false);
  assert.deepEqual(payload.communities.map((community) => community.id), ['A']);
});
scenario('41 resident admin landing API returns no manageable communities', async ({ handle }) => {
  const response = await call(handle, '/api/admin/communities', { token: 'active' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.isPlatformAdmin, false);
  assert.deepEqual(payload.communities, []);
});
scenario('42 profile API exposes verified email and server-derived completeness', async ({ db, handle }) => {
  let response = await call(handle, '/api/me/profile', { token: 'active' });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.profile.emailVerified, false);
  assert.equal(payload.profile.profileComplete, true);

  db.database.prepare("UPDATE user_profiles SET phone=NULL WHERE user_id='active'").run();
  response = await call(handle, '/api/me/profile', { token: 'active' });
  payload = await response.json();
  assert.equal(payload.profile.profileComplete, false);
});
scenario('43 onboarding atomically completes only the authenticated profile', async ({ handle, repositories }) => {
  const targetBefore = await repositories.profiles.findByUserId('target');
  const response = await call(handle, '/api/me/profile/onboarding', {
    method: 'PUT',
    token: 'active',
    body: {
      displayName: '  新姓名  ',
      phone: '0911111111',
      userId: 'target',
      email: 'attacker@example.test',
      emailVerified: false,
      phoneVerified: true,
      defaultCommunityId: null,
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, profileComplete: true });
  const self = await repositories.profiles.findByUserId('active');
  assert.equal(self.display_name, '新姓名');
  assert.equal(self.phone, '0911111111');
  assert.equal(self.phone_verified, 'false');
  assert.equal(self.email, 'resident@example.test');
  assert.equal(self.email_verified, 'false');
  assert.equal(self.default_community_id, 'A');
  const targetAfter = await repositories.profiles.findByUserId('target');
  assert.equal(targetAfter.display_name, targetBefore.display_name);
  assert.equal(targetAfter.phone, targetBefore.phone);
  assert.equal(targetAfter.email, targetBefore.email);
});
scenario('44 onboarding requires an authenticated active canonical user', async ({ handle }) => {
  const body = { displayName: '新會員', phone: '0912345678' };
  assert.equal((await call(handle, '/api/me/profile/onboarding', { method: 'PUT', body })).status, 401);
  assert.equal((await call(handle, '/api/me/profile/onboarding', { method: 'PUT', token: 'suspended', body })).status, 403);
  assert.equal((await call(handle, '/api/me/profile/onboarding', { method: 'PUT', token: 'deleted', body })).status, 403);
});
scenario('45 onboarding validates display name and phone before writing', async ({ handle, repositories }) => {
  const before = await repositories.profiles.findByUserId('active');
  const cases = [
    { displayName: '   ', phone: '0912345678' },
    { displayName: 'a'.repeat(81), phone: '0912345678' },
    { displayName: '新會員', phone: '123' },
    { displayName: '新會員', phone: '0912-345-678' },
  ];
  for (const body of cases) {
    assert.equal((await call(handle, '/api/me/profile/onboarding', { method: 'PUT', token: 'active', body })).status, 422);
  }
  const after = await repositories.profiles.findByUserId('active');
  assert.equal(after.display_name, before.display_name);
  assert.equal(after.phone, before.phone);
  assert.equal(after.phone_verified, before.phone_verified);
});
scenario('46 cross-origin onboarding update is rejected before writing', async ({ handle, repositories }) => {
  const before = await repositories.profiles.findByUserId('active');
  const response = await handle(new Request('http://local.test/api/me/profile/onboarding', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer active',
      'content-type': 'application/json',
      origin: 'https://evil.example',
    },
    body: JSON.stringify({ displayName: '攻擊者', phone: '0999999999' }),
  }));
  assert.equal(response.status, 403);
  const after = await repositories.profiles.findByUserId('active');
  assert.equal(after.display_name, before.display_name);
  assert.equal(after.phone, before.phone);
  assert.equal(after.phone_verified, before.phone_verified);
});
