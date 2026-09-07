import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApplication } from '../../server/application.ts';
import { createProductionAuthentication } from '../../server/auth/adapter.ts';
import { createProductionAuth, handleProductionAuth } from '../../server/auth/better-auth.ts';
import { safeReturnTo } from '../../server/auth/redirect.ts';
import { Repositories } from '../../server/repositories/index.ts';
import { createPhase3Database } from '../helpers/sqlite-database.mjs';

const secret = 'test-only-auth-secret-with-at-least-32-characters';

async function setup() {
  const db = await createPhase3Database();
  db.exec(await readFile(new URL('../../drizzle/0008_auth_storage.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  const sql = db.database;
  sql.prepare(`INSERT INTO users(id) VALUES (?)`).run('existing-email-user');
  sql.prepare(`INSERT INTO user_profiles(user_id,email) VALUES (?,?)`).run('existing-email-user', 'same@example.test');
  sql.prepare(`INSERT INTO user_identities(id,user_id,provider,provider_user_id,verified) VALUES (?,?,?,?,?)`)
    .run('existing-email-identity', 'existing-email-user', 'email', 'same@example.test', 'true');
  sql.prepare(`INSERT INTO auth_users(id,name,email,email_verified,image,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run('auth-user', 'Google User', 'same@example.test', 1, null, now, now);
  sql.prepare(`INSERT INTO auth_accounts(id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run('auth-account', 'google-123', 'google', 'auth-user', now, now);
  sql.prepare(`INSERT INTO auth_sessions(id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)`)
    .run('auth-session', now + 60_000, 'valid-token', now, now, 'auth-user');
  const auth = createProductionAuth({
    DB: db,
    APP_ORIGIN: 'https://app.example.test',
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    BETTER_AUTH_SECRET: secret,
  });
  const application = createApplication(new Repositories({ db }), createProductionAuthentication(auth, db));
  return { auth, application, db, sql };
}

function cookie(token = 'valid-token') {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return `__Host-session=${encodeURIComponent(`${token}.${signature}`)}`;
}

test('verified Google session resolves by sub without email merging and remains stable across email changes', async () => {
  const context = await setup();
  try {
    const call = () => context.application(new Request('https://app.example.test/api/me/profile', { headers: { cookie: cookie() } }));
    assert.equal((await call()).status, 200);
    const googleIdentity = context.sql.prepare(`SELECT * FROM user_identities WHERE provider='google'`).get();
    assert.notEqual(googleIdentity.user_id, 'existing-email-user');
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM users').get().count, 2);
    context.sql.prepare('UPDATE auth_users SET email=? WHERE id=?').run('changed@example.test', 'auth-user');
    assert.equal((await call()).status, 200);
    assert.equal(context.sql.prepare(`SELECT user_id FROM user_identities WHERE provider='google'`).get().user_id, googleIdentity.user_id);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM users').get().count, 2);
  } finally { context.db.close(); }
});

test('tampered, expired and revoked server sessions cannot authenticate', async () => {
  const context = await setup();
  try {
    const call = value => context.application(new Request('https://app.example.test/api/me/profile', { headers: value ? { cookie: value } : {} }));
    assert.equal((await call(cookie())).status, 200);
    assert.equal((await call(`${cookie()}tampered`)).status, 401);
    context.sql.prepare('UPDATE auth_sessions SET expires_at=?').run(Date.now() - 1);
    assert.equal((await call(cookie())).status, 401);
    context.sql.prepare('UPDATE auth_sessions SET expires_at=?').run(Date.now() + 60_000);
    context.sql.prepare('DELETE FROM auth_sessions').run();
    assert.equal((await call(cookie())).status, 401);
  } finally { context.db.close(); }
});

test('Better Auth logout revokes the database session', async () => {
  const context = await setup();
  try {
    const response = await handleProductionAuth(context.auth, new Request('https://app.example.test/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie: cookie(), origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(response.status, 200);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 0);
    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /__Host-session=;/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.doesNotMatch(setCookie, /(?:^|;)\s*Domain=/i);
  } finally { context.db.close(); }
});

test('cross-origin state-changing auth request is rejected', async () => {
  const context = await setup();
  try {
    const response = await context.auth.handler(new Request('https://app.example.test/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie: cookie(), origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(response.status, 403);
    assert.equal(context.sql.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count, 1);
  } finally { context.db.close(); }
});

test('cross-origin authenticated business mutation is rejected before changing data', async () => {
  const context = await setup();
  try {
    const response = await context.application(new Request('https://app.example.test/api/me/profile/display-name', {
      method: 'PUT',
      headers: { cookie: cookie(), origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '攻擊者' }),
    }));
    assert.equal(response.status, 403);
    assert.equal(context.sql.prepare(`SELECT display_name FROM user_profiles WHERE user_id='existing-email-user'`).get().display_name, null);
  } finally { context.db.close(); }
});

test('production session cookie has strict host-only security attributes', async () => {
  const context = await setup();
  try {
    const authContext = await context.auth.$context;
    const configuration = authContext.authCookies.sessionToken;
    assert.equal(authContext.options.advanced.useSecureCookies, true);
    assert.equal(authContext.options.account.encryptOAuthTokens, true);
    assert.equal(configuration.name, '__Secure-session');
    assert.equal(configuration.attributes.httpOnly, true);
    assert.equal(configuration.attributes.secure, true);
    assert.equal(configuration.attributes.sameSite, 'lax');
    assert.equal(configuration.attributes.path, '/');
    assert.equal(configuration.attributes.domain, undefined);
    const oauthState = authContext.createAuthCookie('oauth_state');
    assert.match(oauthState.name, /^__Secure-/);
    assert.equal(oauthState.attributes.secure, true);
  } finally { context.db.close(); }
});

test('production auth responses are never stored by shared caches', async () => {
  const context = await setup();
  try {
    const response = await handleProductionAuth(context.auth, new Request('https://app.example.test/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie: cookie(), origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { context.db.close(); }
});

test('returnTo only accepts same-origin relative paths', () => {
  for (const value of ['/', '/products', '/orders/123', '/admin']) assert.equal(safeReturnTo(value), value);
  for (const value of ['https://evil.example', '//evil.example', 'javascript:alert(1)', 'data:text/html,x']) assert.equal(safeReturnTo(value), '/');
});

test('production authentication source contains no trusted legacy or test identity bypass', async () => {
  const sources = await Promise.all([
    '../../server/runtime.ts', '../../server/auth/adapter.ts', '../../server/auth/better-auth.ts', '../../server/auth/runtime.ts',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const production = sources.join('\n');
  assert.doesNotMatch(production, /oai-authenticated-user-(?:id|email)|E2E_|e2e-session|x-user|NODE_ENV\s*===\s*['"]test/);
  assert.match(production, /providerUserId: account\.account_id/);
});
