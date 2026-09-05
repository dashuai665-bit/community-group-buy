import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createApplication } from '../../../server/application.ts';
import { Repositories } from '../../../server/repositories/index.ts';
import { SQLiteD1Database } from '../../helpers/sqlite-database.mjs';

const upstreamPort = 3210;
const proxyPort = 3211;
const persistencePath = mkdtempSync(join(tmpdir(), 'linli-e2e-'));
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
const fixtureDb = new SQLiteD1Database(new DatabaseSync(':memory:'));
const database = fixtureDb.database;
for (const migration of ['0000_melted_otto_octavius.sql','0001_sticky_taskmaster.sql','0002_magical_gamma_corps.sql','0003_bumpy_cannonball.sql','0004_purchase_batches.sql','0005_purchase_finalization.sql','0006_order_fulfillment.sql','0007_audit_logs_append_only.sql'])
  database.exec(readFileSync(join(process.cwd(), 'drizzle', migration), 'utf8'));
database.exec(`INSERT INTO users(id) VALUES('e2e-resident'),('e2e-admin'),('e2e-other-admin'),('e2e-platform');
INSERT INTO user_profiles(user_id,display_name,phone) VALUES('e2e-resident','測試住戶','0911111111'),('e2e-admin','測試管理員','0922222222'),('e2e-other-admin','其他管理員','0933333333'),('e2e-platform','平台管理員','0944444444');
INSERT INTO user_identities(id,user_id,provider,provider_user_id,verified) VALUES('e2e-ir','e2e-resident','chatgpt','e2e-resident','true'),('e2e-ia','e2e-admin','chatgpt','e2e-admin','true'),('e2e-io','e2e-other-admin','chatgpt','e2e-other-admin','true'),('e2e-ip','e2e-platform','chatgpt','e2e-platform','true');
INSERT INTO communities(id,name,slug,status) VALUES('e2e-c1','瀏覽器測試社區','e2e-c1','active'),('e2e-c2','其他測試社區','e2e-c2','active');
INSERT INTO community_members(id,user_id,community_id,role) VALUES('e2e-mr','e2e-resident','e2e-c1','resident'),('e2e-ma','e2e-admin','e2e-c1','community_admin'),('e2e-mo','e2e-other-admin','e2e-c2','community_admin');
INSERT INTO platform_roles(user_id,role) VALUES('e2e-platform','platform_admin');
INSERT INTO products(id,name,description,source_type,unit_label) VALUES('e2e-p1','測試白米','完整交易測試商品','manual','包'),('e2e-p0','零履約麵條','零履約測試商品','manual','袋');
INSERT INTO community_product_offerings(id,community_id,product_id,status,price_minor,batch_threshold,min_quantity_per_order,max_quantity_per_order) VALUES('e2e-offer-1','e2e-c1','e2e-p1','active',100,10,1,20),('e2e-offer-0','e2e-c1','e2e-p0','active',50,5,1,10);`);

const identities = { resident:'e2e-resident', admin:'e2e-admin', otherAdmin:'e2e-other-admin', platform:'e2e-platform' };
const fixtureApp = createApplication(new Repositories({ db: fixtureDb }), {
  async authenticate(request) {
    const providerUserId = request.headers.get('oai-authenticated-user-id');
    return providerUserId ? { provider: 'chatgpt', providerUserId, verified: true } : null;
  },
});
const proxy = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value && name !== 'host') headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const role = /(?:^|;\s*)e2e-role=([^;]+)/.exec(incoming.headers.cookie ?? '')?.[1];
    if (role && identities[role]) { headers.set('oai-authenticated-user-id', identities[role]); headers.set('oai-authenticated-user-email', `${identities[role]}@sites.test`); }
    headers.delete('cookie');
    if (incoming.url?.startsWith('/api/')) {
      const response = await fixtureApp(new Request(`http://fixture${incoming.url}`, { method: incoming.method, headers, body: ['GET','HEAD'].includes(incoming.method ?? 'GET') ? undefined : Buffer.concat(chunks) }));
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
