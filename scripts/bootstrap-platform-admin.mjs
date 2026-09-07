import { spawnSync } from 'node:child_process';

export const appUserIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function bootstrapSql(userId) {
  if (!appUserIdPattern.test(userId)) throw new Error('Invalid app users.id');
  return `INSERT INTO platform_roles(user_id,role) SELECT id,'platform_admin' FROM users WHERE id='${userId}' ON CONFLICT(user_id,role) DO NOTHING;`;
}

function main() {
  const environmentName = process.argv[2];
  const userId = process.argv[3];
  const apply = process.argv.includes('--apply');
  const confirmationIndex = process.argv.indexOf('--confirm');
  const confirmation = confirmationIndex === -1 ? undefined : process.argv[confirmationIndex + 1];
  if (!['staging', 'production'].includes(environmentName) || !userId || !appUserIdPattern.test(userId)) {
    throw new Error('Usage: pnpm bootstrap:platform-admin <staging|production> <users.id> [--apply --confirm <environment>:<users.id>]');
  }
  if (!apply) {
    console.log(`DRY RUN: verify users.id=${userId} in ${environmentName}; then rerun with --apply --confirm ${environmentName}:${userId}`);
    return;
  }
  if (confirmation !== `${environmentName}:${userId}`) throw new Error('Explicit confirmation does not match target');
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--remote','--env',environmentName,'--command',bootstrapSql(userId),'--yes'], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1]?.endsWith('bootstrap-platform-admin.mjs')) main();
