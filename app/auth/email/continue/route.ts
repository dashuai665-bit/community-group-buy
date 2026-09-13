import { env } from 'cloudflare:workers';
import { createProductionAuthentication } from '@/server/auth/adapter.ts';
import { handleEmailContinuation } from '@/server/auth/email-continuation.ts';
import { getProductionAuth } from '@/server/auth/runtime.ts';
import { Repositories } from '@/server/repositories/index.ts';

export async function GET(request: Request): Promise<Response> {
  const repositories = new Repositories({ db: env.DB });
  return handleEmailContinuation(
    request,
    repositories,
    createProductionAuthentication(getProductionAuth(), env.DB),
  );
}
