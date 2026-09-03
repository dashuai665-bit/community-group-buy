import assert from 'node:assert/strict';
import test from 'node:test';
import { canProceedToOrdering, isProfileComplete } from '../../server/services/index.ts';

test('profile completeness 至少需要 display_name 與 phone', () => {
  assert.equal(isProfileComplete({ display_name: '王小明', phone: '0912345678' }), true);
  assert.equal(isProfileComplete({ display_name: '', phone: '0912345678' }), false);
  assert.equal(isProfileComplete({ display_name: '王小明', phone: null }), false);
});

test('ordering policy 預設不要求 verified phone，且可切換為要求驗證', () => {
  const profile = { display_name: '王小明', phone: '0912345678', phone_verified: 'false' };
  assert.equal(canProceedToOrdering(profile), true);
  assert.equal(canProceedToOrdering(profile, { requireVerifiedPhoneForOrder: true }), false);
  assert.equal(canProceedToOrdering({ ...profile, phone_verified: 'true' }, { requireVerifiedPhoneForOrder: true }), true);
});
