import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join, resolve } from 'node:path';
import { createApplication } from '../../../server/application.ts';
import { Repositories } from '../../../server/repositories/index.ts';
import { SQLiteD1Database } from '../../helpers/sqlite-database.mjs';

const upstreamPort = 3210;
const proxyPort = 3211;
const persistencePath = resolve(process.env.E2E_FIXTURE_DIR ?? mkdtempSync(join(tmpdir(), 'linli-e2e-')));
// Cleanup must stay inside a generated run directory, even if the environment is overridden.
if (dirname(persistencePath).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !/^linli-e2e-[A-Za-z0-9]{6}$/.test(basename(persistencePath)))
  throw new Error('Invalid isolated E2E fixture directory');
const vite = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev', '--port', String(upstreamPort), '--strictPort'], {
  cwd: process.cwd(), stdio: 'inherit',
  env: { ...process.env, E2E_PERSIST_PATH: persistencePath },
});

async function waitForUpstream() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { await fetch(`http://localhost:${upstreamPort}/api/communities`); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error('E2E upstream did not start');
}
await waitForUpstream();
const fixtureDb = new SQLiteD1Database(new DatabaseSync(join(persistencePath, 'fixture.sqlite')));
const database = fixtureDb.database;
for (const migration of ['0000_melted_otto_octavius.sql','0001_sticky_taskmaster.sql','0002_magical_gamma_corps.sql','0003_bumpy_cannonball.sql','0004_purchase_batches.sql','0005_purchase_finalization.sql','0006_order_fulfillment.sql','0007_audit_logs_append_only.sql'])
  database.exec(readFileSync(join(process.cwd(), 'drizzle', migration), 'utf8'));
database.exec(`INSERT INTO users(id) VALUES('e2e-resident'),('e2e-admin'),('e2e-other-admin'),('e2e-platform');
INSERT INTO user_profiles(user_id,display_name,phone) VALUES('e2e-resident','測試住戶','0911111111'),('e2e-admin','測試管理員','0922222222'),('e2e-other-admin','其他管理員','0933333333'),('e2e-platform','平台管理員','0944444444');
INSERT INTO user_identities(id,user_id,provider,provider_user_id,verified) VALUES('e2e-ir','e2e-resident','google','e2e-resident','true'),('e2e-ia','e2e-admin','google','e2e-admin','true'),('e2e-io','e2e-other-admin','google','e2e-other-admin','true'),('e2e-ip','e2e-platform','google','e2e-platform','true');
INSERT INTO communities(id,name,slug,status) VALUES('e2e-c1','瀏覽器測試社區','e2e-c1','active'),('e2e-c2','其他測試社區','e2e-c2','active');
INSERT INTO community_members(id,user_id,community_id,role) VALUES('e2e-mr','e2e-resident','e2e-c1','resident'),('e2e-ma','e2e-admin','e2e-c1','community_admin'),('e2e-mo','e2e-other-admin','e2e-c2','community_admin');
INSERT INTO platform_roles(user_id,role) VALUES('e2e-platform','platform_admin');
INSERT INTO products(id,name,description,source_type,unit_label) VALUES('e2e-p1','測試白米','完整交易測試商品','manual','包'),('e2e-p0','零履約麵條','零履約測試商品','manual','袋');
INSERT INTO community_product_offerings(id,community_id,product_id,status,price_minor,batch_threshold,min_quantity_per_order,max_quantity_per_order) VALUES('e2e-offer-1','e2e-c1','e2e-p1','active',100,10,1,20),('e2e-offer-0','e2e-c1','e2e-p0','active',50,5,1,10);`);

// A separate community's historical audit rows exercise pagination without polluting the live journey.
const auditSeed = database.prepare(`INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id,metadata,created_at)
  VALUES(?,'e2e-other-admin','e2e-c2','pickup_ready','order',?,?,?)`);
for (let index = 0; index < 23; index += 1) {
  auditSeed.run('e2e-audit-' + index, 'historical-order-' + index, JSON.stringify({
    event: index >= 21 ? 'ORDER_HANDED_OVER' : 'CASH_PAYMENT_CONFIRMED', amountMinor: 840,
    phone: 'audit-private-phone', storageKey: 'audit-private-storage', token: 'audit-private-token',
  }), '2026-01-01 00:00:' + String(index).padStart(2, '0'));
}

const identities = { resident:'e2e-resident', admin:'e2e-admin', otherAdmin:'e2e-other-admin', platform:'e2e-platform' };
const sessions = new Map();
const fixtureApp = createApplication(new Repositories({ db: fixtureDb }), {
  async authenticate(request) {
    const token = /(?:^|;\s*)e2e-session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
    const providerUserId = token ? sessions.get(token) : null;
    return providerUserId ? { provider: 'google', providerUserId, verified: true } : null;
  },
});
const proxy = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value && name !== 'host') headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const loginMatch = /^\/__test\/auth\/login\/(resident|admin|otherAdmin|platform)$/.exec(incoming.url ?? '');
    if (incoming.method === 'POST' && loginMatch) {
      const token = crypto.randomUUID();
      sessions.set(token, identities[loginMatch[1]]);
      outgoing.writeHead(204, { 'x-e2e-session': token });
      outgoing.end(); return;
    }
    if (incoming.method === 'GET' && incoming.url?.startsWith('/auth/login?')) {
      outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      outgoing.end('<!doctype html><html lang="zh-Hant"><title>登入</title><body><h1>Google 登入</h1></body></html>');
      return;
    }
    if (incoming.method === 'POST' && incoming.url === '/auth/logout') {
      const token = /(?:^|;\s*)e2e-session=([^;]+)/.exec(incoming.headers.cookie ?? '')?.[1];
      if (token) sessions.delete(token);
      outgoing.writeHead(303, { location: '/', 'set-cookie': 'e2e-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      outgoing.end(); return;
    }
    if (incoming.url?.startsWith('/api/')) {
      const response = await fixtureApp(new Request(`http://127.0.0.1:${proxyPort}${incoming.url}`, { method: incoming.method, headers, body: ['GET','HEAD'].includes(incoming.method ?? 'GET') ? undefined : Buffer.concat(chunks) }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const response = await fetch(`http://localhost:${upstreamPort}${incoming.url}`, { method: incoming.method, headers, body: ['GET','HEAD'].includes(incoming.method ?? 'GET') ? undefined : Buffer.concat(chunks), redirect: 'manual' });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { outgoing.writeHead(502, {'content-type':'text/plain'}); outgoing.end(error instanceof Error ? error.message : 'proxy error'); }
});
proxy.listen(proxyPort, '127.0.0.1');
const stop = () => { proxy.close(); vite.kill(); fixtureDb.close(); rmSync(persistencePath, { recursive: true, force: true }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', () => rmSync(persistencePath, { recursive: true, force: true }));
