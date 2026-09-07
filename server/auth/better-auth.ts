import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import { authSchema } from './schema.ts';

const externalSessionCookieName = '__Host-session';
const internalSessionCookieName = '__Secure-session';

function renameCookie(source: string, from: string, to: string) {
  return source.replace(new RegExp(`(^|[;,]\\s*)${from}=`, 'g'), `$1${to}=`);
}

export function withInternalSessionCookie(headers: Headers) {
  const result = new Headers(headers);
  const cookie = result.get('cookie');
  if (cookie) result.set('cookie', renameCookie(cookie, externalSessionCookieName, internalSessionCookieName));
  return result;
}

export async function handleProductionAuth(auth: ProductionAuth, request: Request) {
  const internalRequest = new Request(request, { headers: withInternalSessionCookie(request.headers) });
  const response = await auth.handler(internalRequest);
  const headers = new Headers(response.headers);
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    headers.delete('set-cookie');
    for (const setCookie of setCookies) {
      headers.append('set-cookie', renameCookie(setCookie, internalSessionCookieName, externalSessionCookieName));
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export interface AuthEnvironment {
  DB: D1Database;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
}

export function createProductionAuth(environment: AuthEnvironment) {
  return betterAuth({
    appName: '鄰里湊湊',
    baseURL: environment.APP_ORIGIN,
    secret: environment.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(environment.DB, { schema: authSchema }), {
      provider: 'sqlite',
      schema: authSchema,
    }),
    user: { modelName: 'authUser' },
    session: { modelName: 'authSession', cookieCache: { enabled: false } },
    account: {
      modelName: 'authAccount',
      encryptOAuthTokens: true,
      accountLinking: { enabled: false, disableImplicitLinking: true },
      storeStateStrategy: 'database',
    },
    verification: { modelName: 'authVerification' },
    socialProviders: {
      google: {
        clientId: environment.GOOGLE_CLIENT_ID,
        clientSecret: environment.GOOGLE_CLIENT_SECRET,
      },
    },
    trustedOrigins: [environment.APP_ORIGIN],
    advanced: {
      useSecureCookies: true,
      cookies: {
        session_token: {
          // Better Auth 1.7.2 prepends __Secure- when secure cookies are forced.
          // The route boundary maps only this session cookie to __Host-session.
          name: 'session',
          attributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
        },
      },
    },
  });
}

export type ProductionAuth = ReturnType<typeof createProductionAuth>;
