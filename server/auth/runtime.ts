import { env } from 'cloudflare:workers';
import { createProductionAuth, type AuthEnvironment } from './better-auth.ts';

function requireEnvironment(): AuthEnvironment {
  const required = ['DB', 'APP_ORIGIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET'] as const;
  for (const key of required) if (!env[key]) throw new Error(`Missing production auth configuration: ${key}`);
  return env as AuthEnvironment;
}

let instance: ReturnType<typeof createProductionAuth> | undefined;
export function getProductionAuth() {
  return instance ??= createProductionAuth(requireEnvironment());
}
