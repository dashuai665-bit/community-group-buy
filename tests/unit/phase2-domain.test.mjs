import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageCommunity } from '../../domain/authorization.ts';
import {
  joinCommunity,
  leaveCommunity,
  setDefaultCommunity,
  switchBrowsingCommunity,
} from '../../domain/community-service.ts';
import {
  changeProfilePhone,
  completeProfileAfterExternalLogin,
  linkIdentityFromAuthenticatedSession,
  unlinkIdentity,
} from '../../domain/identity-service.ts';
import { createUserAccount } from '../../domain/registration-service.ts';
import {
  maskPhone,
  sanitizeLogFields,
  serializePublicCommunityMember,
} from '../../lib/privacy.ts';
import {
  addCommunity,
  addMembership,
  addUser,
  InMemoryRepository,
} from '../helpers/in-memory-repository.mjs';

async function rejectsWithCode(action, code) {
  await assert.rejects(action, (error) => error?.code === code);
}

test('同一 user 可以加入 A/B/C，且不可重複加入同一社區', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  for (const id of ['A', 'B', 'C']) addCommunity(repository, id);

  await Promise.all(['A', 'B', 'C'].map((id) => joinCommunity(repository, 'user-1', id)));
  assert.equal(repository.memberships.size, 3);
  await rejectsWithCode(() => joinCommunity(repository, 'user-1', 'A'), 'MEMBERSHIP_EXISTS');
});

test('default community 必須是使用者的 active membership 與 active community', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  addCommunity(repository, 'A');
  addCommunity(repository, 'inactive', { status: 'inactive' });

  await rejectsWithCode(() => setDefaultCommunity(repository, 'user-1', 'A'), 'MEMBERSHIP_REQUIRED');
  addMembership(repository, 'user-1', 'inactive');
  await rejectsWithCode(
    () => setDefaultCommunity(repository, 'user-1', 'inactive'),
    'COMMUNITY_INACTIVE',
  );
  addMembership(repository, 'user-1', 'A');
  await setDefaultCommunity(repository, 'user-1', 'A');
  assert.equal(await repository.getDefaultCommunityId('user-1'), 'A');
});

test('切換 browsing community 不會修改 default community', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  addCommunity(repository, 'A');
  addCommunity(repository, 'C');
  addMembership(repository, 'user-1', 'A');
  addMembership(repository, 'user-1', 'C');
  await repository.setDefaultCommunityId('user-1', 'A');

  const context = await switchBrowsingCommunity(
    repository,
    { userId: 'user-1', browsingCommunityId: 'A' },
    'C',
  );
  assert.equal(context.browsingCommunityId, 'C');
  assert.equal(await repository.getDefaultCommunityId('user-1'), 'A');
});

test('community_admin 只能管理自己的社區', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'admin');
  addCommunity(repository, 'A');
  addCommunity(repository, 'B');
  addMembership(repository, 'admin', 'A', { role: 'community_admin' });
  addMembership(repository, 'admin', 'B');

  assert.equal(await canManageCommunity(repository, 'admin', 'A'), true);
  assert.equal(await canManageCommunity(repository, 'admin', 'B'), false);
});

test('platform_admin 可以跨社區，resident 不具有管理權限', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'platform-admin');
  addUser(repository, 'resident');
  addCommunity(repository, 'A');
  addMembership(repository, 'resident', 'A');
  repository.platformAdmins.add('platform-admin');

  assert.equal(await canManageCommunity(repository, 'platform-admin', 'A'), true);
  assert.equal(await canManageCommunity(repository, 'resident', 'A'), false);
});

test('相同 email 或 phone 建立獨立 users，不會自動 merge', async () => {
  const repository = new InMemoryRepository();
  const contact = { email: 'same@example.test', phone: '0900000000' };
  const first = await createUserAccount(repository, contact);
  const second = await createUserAccount(repository, contact);

  assert.notEqual(first.user.id, second.user.id);
  assert.equal(repository.users.size, 2);
});

test('phone verified 與 email verified 獨立，外部登入填電話不會自動驗證', () => {
  const profile = {
    userId: 'user-1',
    displayName: null,
    phone: null,
    phoneVerified: false,
    email: 'verified@example.test',
    emailVerified: true,
    defaultCommunityId: null,
  };
  const completed = completeProfileAfterExternalLogin(profile, '0912345678');
  assert.equal(completed.emailVerified, true);
  assert.equal(completed.phoneVerified, false);
});

test('修改 verified phone 後 phone_verified 會回到 false', () => {
  const profile = {
    userId: 'user-1',
    displayName: null,
    phone: '0912345678',
    phoneVerified: true,
    email: null,
    emailVerified: false,
    defaultCommunityId: null,
  };
  assert.equal(changeProfilePhone(profile, '0987654321').phoneVerified, false);
});

test('identity 只能由已登入 user 主動綁定，且不可解除最後一個 identity', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  const identity = await linkIdentityFromAuthenticatedSession(repository, 'user-1', {
    provider: 'google',
    providerUserId: 'google-subject-1',
    verified: true,
  });
  assert.equal(identity.userId, 'user-1');
  await rejectsWithCode(
    () => unlinkIdentity(repository, 'user-1', identity.id),
    'LAST_LOGIN_IDENTITY',
  );
  await rejectsWithCode(
    () => unlinkIdentity(repository, 'other-user', identity.id),
    'IDENTITY_NOT_OWNED',
  );
});

test('public serializer 排除 phone、email 與 identity metadata', () => {
  const result = serializePublicCommunityMember({
    id: 'member-1',
    userId: 'user-1',
    displayName: '測試住戶',
    phone: '0912345678',
    email: 'private@example.test',
    identityMetadata: { token: 'never-return' },
  });
  assert.deepEqual(result, { id: 'member-1', userId: 'user-1', displayName: '測試住戶' });
});

test('phone masking 與 log sanitization 不洩漏敏感欄位', () => {
  assert.equal(maskPhone('0912345678'), '0912***678');
  assert.deepEqual(
    sanitizeLogFields({ phone: '0912345678', otp: '123456', session_token: 'secret', action: 'login' }),
    { phone: '0912***678', action: 'login' },
  );
});

test('inactive community 不接受新的 membership', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  addCommunity(repository, 'A', { status: 'inactive' });
  await rejectsWithCode(() => joinCommunity(repository, 'user-1', 'A'), 'COMMUNITY_INACTIVE');
});

test('離開 default community 後選另一個 active default，沒有替代時設為 null', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  addCommunity(repository, 'A');
  addCommunity(repository, 'B');
  addMembership(repository, 'user-1', 'A');
  addMembership(repository, 'user-1', 'B');
  await repository.setDefaultCommunityId('user-1', 'A');

  await leaveCommunity(repository, 'user-1', 'A');
  assert.equal(await repository.getDefaultCommunityId('user-1'), 'B');
  await leaveCommunity(repository, 'user-1', 'B');
  assert.equal(await repository.getDefaultCommunityId('user-1'), null);
});

test('未完成訂單或取貨 extension point 會阻止離開社區', async () => {
  const repository = new InMemoryRepository();
  addUser(repository, 'user-1');
  addCommunity(repository, 'A');
  addMembership(repository, 'user-1', 'A');
  repository.leaveBlockers.set(repository.membershipKey('user-1', 'A'), {
    unfinishedOrders: true,
    unfinishedPickups: false,
  });
  await rejectsWithCode(() => leaveCommunity(repository, 'user-1', 'A'), 'LEAVE_BLOCKED');
});
