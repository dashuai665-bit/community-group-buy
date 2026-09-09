import type { AuthenticationAdapter } from '../application.ts';
import { withInternalSessionCookie, type ProductionAuth } from './better-auth.ts';

interface AccountRow {
  account_id: string;
  provider_id: string;
}

export function createProductionAuthentication(
  auth: ProductionAuth,
  database: D1Database,
): AuthenticationAdapter {
  return {
    async authenticate(request) {
      const result = await auth.api.getSession({ headers: withInternalSessionCookie(request.headers) });
      if (!result?.user?.id) return null;
      const accounts = await database.prepare(
        `SELECT account_id,provider_id FROM auth_accounts
         WHERE user_id = ? AND provider_id IN ('google','email')`,
      ).bind(result.user.id).all<AccountRow>();
      const google = accounts.results.find((account) => account.provider_id === 'google');
      const email = accounts.results.find((account) => account.provider_id === 'email');
      if (google && !email) {
        return {
          provider: 'google',
          providerUserId: google.account_id,
          verified: true,
          email: result.user.email,
        };
      }
      if (!google && email?.account_id === result.user.id && result.user.emailVerified) {
        return {
          provider: 'email',
          providerUserId: email.account_id,
          verified: true,
          email: result.user.email,
        };
      }
      return null;
    },
  };
}
