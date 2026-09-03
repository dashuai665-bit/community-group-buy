import { env } from 'cloudflare:workers';
import { createApplication, type AuthenticationAdapter } from './application.ts';
import { Repositories } from './repositories/index.ts';

const productionAuthentication: AuthenticationAdapter = {
  async authenticate(request) {
    const providerUserId = request.headers.get('oai-authenticated-user-id');
    if (!providerUserId) return null;
    return {
      provider: 'chatgpt', providerUserId, verified: true,
      email: request.headers.get('oai-authenticated-user-email') ?? undefined,
    };
  },
};

export function handleApiRequest(request: Request): Promise<Response> {
  const repositories = new Repositories({ db: env.DB });
  return createApplication(repositories, productionAuthentication)(request);
}
