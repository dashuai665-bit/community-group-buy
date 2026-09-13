import assert from 'node:assert/strict';
import test from 'node:test';
import { canProceedToOrdering, isProfileComplete, ProfileService } from '../../server/services/index.ts';

test('profile completeness 至少需要 display_name 與 phone', () => {
  assert.equal(isProfileComplete({ display_name: '王小明', phone: '0912345678' }), true);
  assert.equal(isProfileComplete({ display_name: '王小明', phone: null }), false);
  assert.equal(isProfileComplete({ display_name: null, phone: '0912345678' }), false);
  assert.equal(isProfileComplete({ display_name: null, phone: null }), false);
  assert.equal(isProfileComplete({ display_name: '   ', phone: '0912345678' }), false);
});

test('ordering policy 預設不要求 verified phone，且可切換為要求驗證', () => {
  const profile = { display_name: '王小明', phone: '0912345678', phone_verified: 'false' };
  assert.equal(canProceedToOrdering(profile), true);
  assert.equal(canProceedToOrdering(profile, { requireVerifiedPhoneForOrder: true }), false);
  assert.equal(canProceedToOrdering({ ...profile, phone_verified: 'true' }, { requireVerifiedPhoneForOrder: true }), true);
});

test('onboarding service updates only the authenticated canonical user in one statement', async () => {
  const statement = { kind: 'onboarding-update' };
  let statementInput;
  let batchInput;
  const repositories = {
    users: { async findById(id) { return id === 'canonical-user' ? { id, status: 'active' } : null; } },
    profiles: {
      completeOnboardingStatement(userId, displayName, phone) {
        statementInput = { userId, displayName, phone };
        return statement;
      },
    },
    async batch(statements) { batchInput = statements; },
  };
  const service = new ProfileService(repositories);

  await service.completeOnboarding('canonical-user', '王小明', '0912345678');

  assert.deepEqual(statementInput, {
    userId: 'canonical-user',
    displayName: '王小明',
    phone: '0912345678',
  });
  assert.deepEqual(batchInput, [statement]);
  await assert.rejects(
    () => service.completeOnboarding('other-user', '其他人', '0987654321'),
    /登入身份無效/,
  );
});
