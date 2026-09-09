import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 3222;
const persistencePath = mkdtempSync(join(tmpdir(), 'linli-production-e2e-'));
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, ['scripts/build-worker.mjs', 'staging']);
run(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js',
  'd1', 'migrations', 'apply', 'DB', '--local',
  '--config', 'wrangler.jsonc', '--env', 'staging',
  '--persist-to', persistencePath,
]);

const worker = spawn(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js',
  'dev', '--config', 'dist/server/wrangler.json',
  '--port', String(port), '--persist-to', persistencePath,
  '--var', `APP_ORIGIN:http://127.0.0.1:${port}`,
  '--var', 'GOOGLE_CLIENT_ID:production-e2e-client-id',
  '--var', 'GOOGLE_CLIENT_SECRET:production-e2e-client-secret',
  '--var', 'BETTER_AUTH_SECRET:production-e2e-only-secret-32-bytes',
], { cwd: process.cwd(), stdio: 'inherit' });

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  worker.kill();
  rmSync(persistencePath, { recursive: true, force: true });
};

worker.on('exit', (code) => {
  stop();
  process.exitCode = code ?? 0;
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', () => rmSync(persistencePath, { recursive: true, force: true }));
