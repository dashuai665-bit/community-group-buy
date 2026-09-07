import { env } from 'cloudflare:workers';
import { createApplication, type AuthenticationAdapter } from './application.ts';
import { Repositories } from './repositories/index.ts';
import { createProductionAuthentication } from './auth/adapter.ts';
import { getProductionAuth } from './auth/runtime.ts';

export function handleApiRequest(request: Request): Promise<Response> {
  const repositories = new Repositories({ db: env.DB });
  const productionAuthentication: AuthenticationAdapter = {
    authenticate: (authenticatedRequest) =>
      createProductionAuthentication(getProductionAuth(), env.DB).authenticate(authenticatedRequest),
  };
  return createApplication(repositories, productionAuthentication)(request);
}
