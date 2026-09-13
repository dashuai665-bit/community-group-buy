import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { createProductionAuthentication } from '../../server/auth/adapter.ts';
import { createProductionAuth, handleProductionAuth } from '../../server/auth/better-auth.ts';
import {
  D1EmailMagicLinkRepository,
  EmailMagicLinkService,
  handleEmailMagicLinkRequest,
} from '../../server/auth/email-magic-link.ts';
import { FakeEmailProvider } from '../../server/auth/fake-email-provider.ts';
import { EmailDeliveryUnavailableError } from '../../server/auth/email-provider.ts';
import { generateMagicLinkToken } from '../../server/auth/magic-link-token.ts';
import {
  safeEmailContinuationReturnTo,
  safeReturnTo,
} from '../../server/auth/redirect.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase3Database } from '../helpers/sqlite-database.mjs';

const origin = 'https://app.example.test';
const secret = 'test-only-auth-secret-with-at-least-32-characters';

async function setup() {
  const db = await createPhase3Database();
  db.exec(await readFile(new URL('../../drizzle/0008_auth_storage.sql', import.meta.url), 'utf8'));
  const email = new FakeEmailProvider();
  const auth = createProductionAuth({
    DB: db,
    APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    BETTER_AUTH_SECRET: secret,
  }, email);
  const service = new EmailMagicLinkService(auth, new D1EmailMagicLinkRepository(db));
  const application = createApplication(new Repositories({ db }), createProductionAuthentication(auth, db));
  return { application, auth, db, email, service, sql: db.database };
}

function requestMagicLink(context, email, returnTo = '/orders') {
  return handleEmailMagicLinkRequest(new Request(`${origin}/api/auth/email/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, returnTo }),
  }), context.service);
}

async function consume(context, message) {
  return handleProductionAuth(context.auth, new Request(message.url));
}

function responseCookie(response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value);
  return value.split(';', 1)[0];
}

test('magic link tokens have 256-bit entropy and base64url encoding', () => {
  const token = generateMagicLinkToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').byteLength, 32);
  assert.notEqual(generateMagicLinkToken(), token);
});

test('magic link stores only a hash for ten minutes and can be consumed once', async () => {
  const context = await setup();
  try {
    const before = Date.now();
    assert.deepEqual(await (await requestMagicLink(context, ' New@Example.Test ')).json(), { ok: true });
    assert.equal(context.email.messages.length, 1);
    const message = context.email.messages[0];
    assert.equal(message.email, 'new@example.test');
    assert.equal(
      new URL(message.url).searchParams.get('callbackURL'),
      '/auth/email/continue?returnTo=%2Forders',
    );
    const verification = context.sql.prepare('SELECT identifier,value,expires_at FROM auth_verifications').get();
    assert.notEqual(verification.identifier, message.token);
    assert.doesNotMatch(verification.value, new RegExp(message.token));
    assert.ok(verification.expires_at >= before + 599_000);
    assert.ok(verification.expires_at <= before + 601_000);

    const first = await consume(context, message);
    assert.equal(first.status, 302);
    const firstLocation = new URL(first.headers.get('location'));
    assert.equal(firstLocation.pathname, '/auth/email/continue');
    assert.equal(firstLocation.searchParams.get('returnTo'), '/orders');
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 1);
    const second = await consume(context, message);
    assert.equal(second.status, 302);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 1);
  } finally { context.db.close(); }
});

test('expired magic link is rejected without creating a session', async () => {
  const context = await setup();
  try {
    await requestMagicLink(context, 'expired@example.test');
    context.sql.prepare('UPDATE auth_verifications SET expires_at=?').run(Date.now() - 1);
    const response = await consume(context, context.email.messages[0]);
    assert.equal(response.status, 302);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 0);
  } finally { context.db.close(); }
});

test('concurrent real verification consumes one token and mints exactly one session', async () => {
  const context = await setup();
  try {
    await requestMagicLink(context, 'race@example.test');
    const [first, second] = await Promise.all([
      consume(context, context.email.messages[0]),
      consume(context, context.email.messages[0]),
    ]);
    assert.deepEqual([first.status, second.status], [302, 302]);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_users').get().count, 1);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 1);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_verifications').get().count, 0);
  } finally { context.db.close(); }
});

test('email session creates one stable email app identity with verified email only', async () => {
  const context = await setup();
  try {
    await requestMagicLink(context, 'person@example.test');
    const firstVerification = await consume(context, context.email.messages[0]);
    const firstProfile = await context.application(new Request(`${origin}/api/me/profile`, {
      headers: { cookie: responseCookie(firstVerification) },
    }));
    assert.equal(firstProfile.status, 200);
    const authUser = context.sql.prepare('SELECT id FROM auth_users WHERE email=?').get('person@example.test');
    const identity = context.sql.prepare(`SELECT user_id,provider_user_id FROM user_identities WHERE provider='email'`).get();
    assert.equal(identity.provider_user_id, authUser.id);
    const provenance = context.sql.prepare(`SELECT account_id,user_id FROM auth_accounts WHERE provider_id='email'`).get();
    assert.equal(provenance.account_id, authUser.id);
    assert.equal(provenance.user_id, authUser.id);
    const profile = context.sql.prepare('SELECT email,email_verified,phone_verified FROM user_profiles WHERE user_id=?').get(identity.user_id);
    assert.equal(profile.email, 'person@example.test');
    assert.equal(profile.email_verified, 'true');
    assert.equal(profile.phone_verified, 'false');

    await requestMagicLink(context, 'PERSON@example.test');
    const secondVerification = await consume(context, context.email.messages[1]);
    assert.equal((await context.application(new Request(`${origin}/api/me/profile`, {
      headers: { cookie: responseCookie(secondVerification) },
    }))).status, 200);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM users').get().count, 1);
    assert.equal(context.sql.prepare(`SELECT COUNT(*) count FROM user_identities WHERE provider='email'`).get().count, 1);
  } finally { context.db.close(); }
});

test('Google same-email collision is generic but sends no link and creates no email identity', async () => {
  const context = await setup();
  try {
    const now = Date.now();
    context.sql.prepare('INSERT INTO users(id) VALUES (?)').run('google-app-user');
    context.sql.prepare('INSERT INTO user_profiles(user_id,email) VALUES (?,?)').run('google-app-user', 'collision@example.test');
    context.sql.prepare('INSERT INTO user_identities(id,user_id,provider,provider_user_id,verified) VALUES (?,?,?,?,?)')
      .run('google-identity', 'google-app-user', 'google', 'google-sub', 'true');
    context.sql.prepare('INSERT INTO auth_users(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('google-auth-user', 'Google User', 'collision@example.test', 1, now, now);
    context.sql.prepare('INSERT INTO auth_accounts(id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('google-account', 'google-sub', 'google', 'google-auth-user', now, now);

    const response = await requestMagicLink(context, ' COLLISION@EXAMPLE.TEST ');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(context.email.messages.length, 0);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_verifications').get().count, 0);
    assert.equal(context.sql.prepare(`SELECT COUNT(*) count FROM user_identities WHERE provider='email'`).get().count, 0);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM users').get().count, 1);
  } finally { context.db.close(); }
});

test('unavailable production provider fails closed while facade remains generic', async () => {
  const context = await setup();
  try {
    const auth = createProductionAuth({
      DB: context.db,
      APP_ORIGIN: origin,
      GOOGLE_CLIENT_ID: 'test-google-client',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
      BETTER_AUTH_SECRET: secret,
    });
    await assert.rejects(
      auth.api.signInMagicLink({
        body: { email: 'unavailable@example.test', callbackURL: '/' },
        headers: new Headers({ origin }),
      }),
      EmailDeliveryUnavailableError,
    );
    const service = new EmailMagicLinkService(auth, new D1EmailMagicLinkRepository(context.db));
    const response = await handleEmailMagicLinkRequest(new Request(`${origin}/api/auth/email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'unavailable@example.test' }),
    }), service);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally { context.db.close(); }
});

test('session lifetime is fixed at 30 days, does not roll, and preserves cookie contract', async () => {
  const context = await setup();
  try {
    const authContext = await context.auth.$context;
    assert.equal(authContext.options.session.expiresIn, 60 * 60 * 24 * 30);
    assert.equal(authContext.options.session.disableSessionRefresh, true);
    assert.equal(authContext.options.session.cookieCache.enabled, false);
    await requestMagicLink(context, 'session@example.test');
    const verification = await consume(context, context.email.messages[0]);
    const setCookie = verification.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /__Host-session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.doesNotMatch(setCookie, /(?:^|;)\s*Domain=/i);
    const before = context.sql.prepare('SELECT expires_at,updated_at FROM auth_sessions').get();
    assert.ok(before.expires_at >= Date.now() + (30 * 24 * 60 * 60 * 1000) - 2_000);
    assert.ok(before.expires_at <= Date.now() + (30 * 24 * 60 * 60 * 1000) + 2_000);
    const response = await handleProductionAuth(context.auth, new Request(`${origin}/api/auth/get-session`, {
      headers: { cookie: responseCookie(verification) },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(context.sql.prepare('SELECT expires_at,updated_at FROM auth_sessions').get(), before);
    const logout = await handleProductionAuth(context.auth, new Request(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie: responseCookie(verification), origin, 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(logout.status, 200);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 0);
  } finally { context.db.close(); }
});

test('facade rejects malformed/cross-origin input and returnTo cannot escape the origin', async () => {
  const context = await setup();
  try {
    const malformed = await handleEmailMagicLinkRequest(new Request(`${origin}/api/auth/email/request`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{',
    }), context.service);
    assert.equal(malformed.status, 400);
    const invalid = await requestMagicLink(context, 'not-an-email');
    assert.equal(invalid.status, 400);
    const crossOrigin = await handleEmailMagicLinkRequest(new Request(`${origin}/api/auth/email/request`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'safe@example.test' }),
    }), context.service);
    assert.equal(crossOrigin.status, 403);
    for (const value of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/%2f%2fevil.example']) {
      await requestMagicLink(context, `safe-${context.email.messages.length}@example.test`, value);
      const callback = new URL(
        new URL(context.email.messages.at(-1).url).searchParams.get('callbackURL'),
        origin,
      );
      assert.equal(callback.pathname, '/auth/email/continue');
      assert.equal(
        callback.searchParams.get('returnTo'),
        safeEmailContinuationReturnTo(safeReturnTo(value)),
      );
    }
  } finally { context.db.close(); }
});

test('production magic-link source contains no test bypass or token logging', async () => {
  const sources = await Promise.all([
    '../../server/auth/better-auth.ts',
    '../../server/auth/email-magic-link.ts',
    '../../server/auth/email-provider.ts',
    '../../server/auth/magic-link-token.ts',
    '../../app/api/auth/[...all]/route.ts',
    '../../app/api/auth/email/request/route.ts',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  const production = sources.join('\n');
  assert.doesNotMatch(production, /E2E_|x-user|test header|console\.(?:log|info|debug)|process\.env\.NODE_ENV/);
  assert.match(production, /storeToken: 'hashed'/);
  assert.match(production, /expiresIn: 600/);
  assert.match(production, /\/api\/auth\/sign-in\/magic-link/);
});
