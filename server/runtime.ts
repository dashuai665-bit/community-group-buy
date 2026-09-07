import { env } from 'cloudflare:workers';
import { createApplication, type AuthenticationAdapter } from './application.ts';
import { Repositories } from './repositories/index.ts';

const productionAuthentication: AuthenticationAdapter = {
  async authenticate() {
    // C3B will install a server-verified production identity provider. Until
    // then, fail closed: no request header is an authentication credential.
    return null;
  },
};

export function handleApiRequest(request: Request): Promise<Response> {
  const repositories = new Repositories({ db: env.DB });
  return createApplication(repositories, productionAuthentication)(request);
}
