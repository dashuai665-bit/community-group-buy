import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEmailContinuation } from '../../server/auth/email-continuation.ts';
import {
  emailContinuationPath,
  safeEmailContinuationReturnTo,
  safeOnboardingReturnTo,
} from '../../server/auth/redirect.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase3Database } from '../helpers/sqlite-database.mjs';

const origin = 'https://app.example.test';

async function setup() {
  const db = await createPhase3Database();
  db.exec(`
    INSERT INTO users(id,status) VALUES
      ('complete','active'),
      ('incomplete','active'),
      ('suspended','suspended'),
      ('deleted','deleted'),
      ('missing-profile','active');
    INSERT INTO user_profiles(user_id,display_name,phone) VALUES
      ('complete','完整會員','0900000001'),
      ('incomplete','待補資料',NULL),
      ('suspended','停權會員','0900000002'),
      ('deleted','刪除會員','0900000003');
    INSERT INTO user_identities(id,user_id,provider,provider_user_id,verified) VALUES
      ('complete-identity','complete','email','auth-complete','true'),
      ('incomplete-identity','incomplete','email','auth-incomplete','true'),
      ('suspended-identity','suspended','email','auth-suspended','true'),
      ('deleted-identity','deleted','email','auth-deleted','true'),
      ('missing-profile-identity','missing-profile','email','auth-missing-profile','true');
  `);
  const repositories = new Repositories({ db });
  const identities = {
    complete: { provider: 'email', providerUserId: 'auth-complete', verified: true },
    incomplete: { provider: 'email', providerUserId: 'auth-incomplete', verified: true },
    suspended: { provider: 'email', providerUserId: 'auth-suspended', verified: true },
    deleted: { provider: 'email', providerUserId: 'auth-deleted', verified: true },
    missing: { provider: 'email', providerUserId: 'auth-missing-profile', verified: true },
  };
  const authentication = {
    async authenticate(request) {
      return identities[request.headers.get('x-test-session')] ?? null;
    },
  };
  const call = (session, returnTo = '/orders') => {
    const headers = session ? { 'x-test-session': session } : undefined;
    return handleEmailContinuation(
      new Request(
        `${origin}/auth/email/continue?returnTo=${encodeURIComponent(returnTo)}`,
        { headers },
      ),
      repositories,
      authentication,
    );
  };
  return { call, db, repositories, sql: db.database };
}

test('continuation sends complete profiles to the safe final destination', async () => {
  const context = await setup();
  try {
    const response = await context.call('complete', '/products/abc?x=1');
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/products/abc?x=1');

    const repeated = await context.call('complete', '/orders');
    assert.equal(repeated.status, 303);
    assert.equal(repeated.headers.get('location'), '/orders');
  } finally {
    context.db.close();
  }
});

test('continuation sends incomplete profiles to onboarding with an encoded destination', async () => {
  const context = await setup();
  try {
    const response = await context.call('incomplete', '/products/abc?x=1');
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('location'),
      '/onboarding?returnTo=%2Fproducts%2Fabc%3Fx%3D1',
    );
  } finally {
    context.db.close();
  }
});

test('anonymous continuation returns to login without reading or creating app data', async () => {
  const context = await setup();
  try {
    let profileReads = 0;
    const findByUserId = context.repositories.profiles.findByUserId.bind(
      context.repositories.profiles,
    );
    context.repositories.profiles.findByUserId = (...args) => {
      profileReads += 1;
      return findByUserId(...args);
    };
    const before = {
      users: context.sql.prepare('SELECT COUNT(*) count FROM users').get().count,
      profiles: context.sql.prepare('SELECT COUNT(*) count FROM user_profiles').get().count,
      identities: context.sql.prepare('SELECT COUNT(*) count FROM user_identities').get().count,
    };
    const response = await context.call(null, '/orders');
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/auth/login?returnTo=%2Forders');
    assert.equal(profileReads, 0);
    assert.deepEqual(
      {
        users: context.sql.prepare('SELECT COUNT(*) count FROM users').get().count,
        profiles: context.sql.prepare('SELECT COUNT(*) count FROM user_profiles').get().count,
        identities: context.sql.prepare('SELECT COUNT(*) count FROM user_identities').get().count,
      },
      before,
    );
  } finally {
    context.db.close();
  }
});

test('suspended, deleted, and missing-profile users fail closed', async () => {
  const context = await setup();
  try {
    for (const session of ['suspended', 'deleted']) {
      const response = await context.call(session);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'USER_INACTIVE');
    }
    const missing = await context.call('missing');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'PROFILE_NOT_FOUND');
  } finally {
    context.db.close();
  }
});

test('continuation destination policy rejects unsafe and self-loop values', () => {
  assert.equal(safeEmailContinuationReturnTo('/orders'), '/orders');
  assert.equal(
    safeEmailContinuationReturnTo('/products/abc?x=1'),
    '/products/abc?x=1',
  );
  for (const value of [
    'https://evil.example',
    '//evil.example',
    'https%3A%2F%2Fevil.example',
    '/\\evil.example',
    '/%5cevil.example',
    '%',
    '/auth/email/continue',
    '/auth/email/continue?returnTo=%2Forders',
    '/auth/email/continue/nested',
  ]) {
    assert.equal(safeEmailContinuationReturnTo(value), '/', value);
  }
  assert.equal(
    emailContinuationPath('/products/abc?x=1'),
    '/auth/email/continue?returnTo=%2Fproducts%2Fabc%3Fx%3D1',
  );
});

test('onboarding destination reuses safe policy and blocks onboarding or continuation loops', () => {
  for (const value of ['/', '/orders', '/products/abc?x=1']) {
    assert.equal(safeOnboardingReturnTo(value), value);
  }
  for (const value of [
    'https://evil.example',
    '//evil.example',
    'https%3A%2F%2Fevil.example',
    '/\\evil.example',
    '/%5cevil.example',
    '%',
    '/onboarding',
    '/%6fnboarding',
    '/onboarding%2Ffoo',
    '/onboarding?returnTo=%2Forders',
    '/auth/%65mail/continue',
    '/auth/email/continue?returnTo=%2Forders',
  ]) {
    assert.equal(safeOnboardingReturnTo(value), '/', value);
  }
  assert.equal(
    safeEmailContinuationReturnTo('/auth/%65mail/continue'),
    '/',
  );
  assert.equal(
    safeOnboardingReturnTo('/products/abc?x=1'),
    '/products/abc?x=1',
  );
});
