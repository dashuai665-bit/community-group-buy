import { spawnSync } from 'node:child_process';

const environmentName = process.argv[2];
if (!['staging', 'production'].includes(environmentName)) {
  throw new Error('Usage: node scripts/build-worker.mjs <staging|production>');
}

const result = spawnSync(process.execPath, ['node_modules/vinext/dist/cli.js','build'], {
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_ENV: environmentName },
});
if (result.status !== 0) process.exitCode = result.status ?? 1;
