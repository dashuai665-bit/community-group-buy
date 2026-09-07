import { readFile } from 'node:fs/promises';

export function validateEnvironment(config, environmentName) {
  const environment = config.env?.[environmentName];
  const otherEnvironmentName = environmentName === 'staging' ? 'production' : 'staging';
  const otherEnvironment = config.env?.[otherEnvironmentName];
  const errors = [];
  if (!['staging', 'production'].includes(environmentName)) errors.push('environment must be staging or production');
  if (!environment?.name || /REPLACE|PLACEHOLDER/i.test(environment.name)) errors.push('Worker name is not configured');
  const origin = environment?.vars?.APP_ORIGIN;
  if (!origin || !origin.startsWith('https://') || origin.endsWith('.invalid')) errors.push('APP_ORIGIN must be a real HTTPS origin');
  if (!environment?.vars?.GOOGLE_CLIENT_ID || /REPLACE/i.test(environment.vars.GOOGLE_CLIENT_ID)) errors.push('GOOGLE_CLIENT_ID is not configured');
  const databases = environment?.d1_databases ?? [];
  if (databases.length !== 1 || databases[0]?.binding !== 'DB') errors.push('exactly one DB binding is required');
  const databaseId = databases[0]?.database_id ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)) errors.push('D1 database_id is not configured');
  if (databases[0]?.migrations_dir !== 'migrations') errors.push('D1 migrations_dir must be migrations');
  const otherDatabase = otherEnvironment?.d1_databases?.[0];
  if (databaseId && databaseId === otherDatabase?.database_id) errors.push('staging and production must use different D1 database_id values');
  if (origin && origin === otherEnvironment?.vars?.APP_ORIGIN) errors.push('staging and production must use different APP_ORIGIN values');
  if (environment?.vars?.GOOGLE_CLIENT_ID && environment.vars.GOOGLE_CLIENT_ID === otherEnvironment?.vars?.GOOGLE_CLIENT_ID) errors.push('staging and production must use different GOOGLE_CLIENT_ID values');
  if (databases[0]?.database_name && databases[0].database_name === otherDatabase?.database_name) errors.push('staging and production must use different D1 database_name values');
  return errors;
}

if (process.argv[1]?.endsWith('check-production-config.mjs')) {
  const environmentName = process.argv[2];
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const errors = validateEnvironment(config, environmentName);
  if (errors.length) {
    console.error(`Predeploy blocked for ${environmentName ?? '(missing environment)'}:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Configuration preflight passed for ${environmentName}. Confirm secrets and pending migrations manually.`);
  }
}
