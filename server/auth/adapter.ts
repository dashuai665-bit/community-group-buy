import type { AuthenticationAdapter } from '../application.ts';
import { withInternalSessionCookie, type ProductionAuth } from './better-auth.ts';

interface AccountRow { account_id: string }

export function createProductionAuthentication(
  auth: ProductionAuth,
  database: D1Database,
): AuthenticationAdapter {
  return {
    async authenticate(request) {
      const result = await auth.api.getSession({ headers: withInternalSessionCookie(request.headers) });
      if (!result?.user?.id) return null;
      const account = await database.prepare(
        `SELECT account_id FROM auth_accounts
         WHERE user_id = ? AND provider_id = 'google'
         LIMIT 1`,
      ).bind(result.user.id).first<AccountRow>();
      if (!account?.account_id) return null;
      return {
        provider: 'google',
        providerUserId: account.account_id,
        verified: true,
        email: result.user.email,
      };
    },
  };
}
