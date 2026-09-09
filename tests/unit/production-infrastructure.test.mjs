import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { bootstrapSql } from '../../scripts/bootstrap-platform-admin.mjs';
import { validateEnvironment } from '../../scripts/check-production-config.mjs';

test('production config isolates staging and production and rejects placeholders', async () => {
  const config = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const runbook = await readFile(new URL('../../docs/production-deployment.md', import.meta.url), 'utf8');
  assert.equal(config.env.staging.d1_databases[0].binding, 'DB');
  assert.equal(config.env.production.d1_databases[0].binding, 'DB');
  assert.notEqual(config.env.staging.d1_databases[0].database_id, config.env.production.d1_databases[0].database_id);
  assert.notEqual(config.env.staging.d1_databases[0].database_name, config.env.production.d1_databases[0].database_name);
  assert.notEqual(config.env.staging.vars.APP_ORIGIN, config.env.production.vars.APP_ORIGIN);
  assert.equal('GOOGLE_CLIENT_SECRET' in config.env.staging.vars, false);
  assert.equal('BETTER_AUTH_SECRET' in config.env.production.vars, false);
  assert.doesNotMatch(JSON.stringify(config), /site-creator-d1|00000000-0000-4000-8000/);
  assert.deepEqual(validateEnvironment(config, 'staging'), []);
  assert.ok(validateEnvironment(config, 'production').length > 0);
  const placeholderConfig = structuredClone(config);
  placeholderConfig.env.staging.vars.APP_ORIGIN = 'https://staging.example.invalid';
  placeholderConfig.env.staging.vars.GOOGLE_CLIENT_ID = 'REPLACE_WITH_STAGING_GOOGLE_CLIENT_ID';
  placeholderConfig.env.staging.d1_databases[0].database_id = 'REPLACE_WITH_STAGING_D1_DATABASE_ID';
  assert.ok(validateEnvironment(placeholderConfig, 'staging').length > 0);
  assert.equal(config.env.staging.d1_databases[0].migrations_dir, 'migrations');
  assert.match(manifest.scripts['build:staging'], /build-worker\.mjs staging/);
  assert.match(manifest.scripts['build:production'], /build-worker\.mjs production/);
  assert.doesNotMatch(manifest.scripts['build:production'], /deploy/);
  assert.match(runbook, /pnpm exec wrangler deploy --config dist\/server\/wrangler\.json/);
  assert.doesNotMatch(runbook, /pnpm exec wrangler deploy(?:`|\s*$)/m);
  assert.doesNotMatch(runbook, /^pnpm exec wrangler deploy --env/m);
});

test('predeploy rejects valid-looking resources shared across environments', () => {
  const sharedDatabaseId = '12345678-1234-4123-8123-123456789abc';
  const config = {
    env: {
      staging: environmentConfig('staging', sharedDatabaseId),
      production: environmentConfig('production', sharedDatabaseId),
    },
  };

  config.env.production.vars.APP_ORIGIN = config.env.staging.vars.APP_ORIGIN;
  config.env.production.vars.GOOGLE_CLIENT_ID = config.env.staging.vars.GOOGLE_CLIENT_ID;
  config.env.production.d1_databases[0].database_name = config.env.staging.d1_databases[0].database_name;

  const errors = validateEnvironment(config, 'staging');
  assert.ok(errors.includes('staging and production must use different D1 database_id values'));
  assert.ok(errors.includes('staging and production must use different APP_ORIGIN values'));
  assert.ok(errors.includes('staging and production must use different GOOGLE_CLIENT_ID values'));
  assert.ok(errors.includes('staging and production must use different D1 database_name values'));
});

function environmentConfig(name, databaseId) {
  return {
    name: `linli-coucou-${name}`,
    vars: {
      APP_ORIGIN: `https://${name}.example.com`,
      GOOGLE_CLIENT_ID: `${name}-client.apps.googleusercontent.com`,
    },
    d1_databases: [{
      binding: 'DB',
      database_name: `linli-coucou-${name}`,
      database_id: databaseId,
      migrations_dir: 'migrations',
    }],
  };
}

test('platform admin bootstrap requires an existing users.id and is idempotent', () => {
  const database = new DatabaseSync(':memory:');
  database.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE platform_roles(user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role='platform_admin'),PRIMARY KEY(user_id,role)); CREATE TABLE community_members(user_id TEXT,community_id TEXT,role TEXT); INSERT INTO users(id)VALUES('known-user'); INSERT INTO community_members VALUES('known-user','community-a','community_admin');");
  database.exec(bootstrapSql('missing-user'));
  assert.equal(database.prepare('SELECT COUNT(*) count FROM platform_roles').get().count, 0);
  database.exec(bootstrapSql('known-user'));
  database.exec(bootstrapSql('known-user'));
  assert.deepEqual({ ...database.prepare('SELECT user_id,role FROM platform_roles').get() }, { user_id: 'known-user', role: 'platform_admin' });
  assert.throws(() => bootstrapSql("x';DELETE FROM users;--"), /Invalid/);
  assert.throws(() => bootstrapSql('admin@example.test'), /Invalid/);
  assert.deepEqual({ ...database.prepare('SELECT * FROM community_members').get() }, { user_id: 'known-user', community_id: 'community-a', role: 'community_admin' });
  database.close();
});


test('production response policy sets safe headers and API no-store', async () => {
  const proxy = await readFile(new URL('../../proxy.ts', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../../server/runtime.ts', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../../server/auth/better-auth.ts', import.meta.url), 'utf8');
  assert.match(proxy, /X-Content-Type-Options.*nosniff/s);
  assert.match(proxy, /Referrer-Policy.*strict-origin-when-cross-origin/s);
  assert.match(proxy, /Content-Security-Policy.*frame-ancestors 'none'/s);
  assert.match(runtime, /Cache-Control', 'no-store'/);
  assert.match(auth, /Cache-Control', 'no-store'/);
});
