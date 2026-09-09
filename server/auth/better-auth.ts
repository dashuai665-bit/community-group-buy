import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/d1';
import type { EmailDeliveryProvider } from './email-provider.ts';
import { unavailableEmailProvider } from './email-provider.ts';
import { generateMagicLinkToken } from './magic-link-token.ts';
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
  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const requestInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers: withInternalSessionCookie(request.headers),
    redirect: request.redirect,
    signal: request.signal,
  };
  if (hasBody && request.body) {
    requestInit.body = request.body;
    requestInit.duplex = 'half';
  }

  const internalRequest = new Request(request.url, requestInit);
  const response = await auth.handler(internalRequest);
  const headers = new Headers(response.headers);
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    headers.delete('set-cookie');
    for (const setCookie of setCookies) {
      headers.append('set-cookie', renameCookie(setCookie, internalSessionCookieName, externalSessionCookieName));
    }
  }
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export interface AuthEnvironment {
  DB: D1Database;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
}

export function createProductionAuth(
  environment: AuthEnvironment,
  emailProvider: EmailDeliveryProvider = unavailableEmailProvider,
) {
  return betterAuth({
    appName: '鄰里湊湊',
    baseURL: environment.APP_ORIGIN,
    secret: environment.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(environment.DB, { schema: authSchema }), {
      provider: 'sqlite',
      schema: authSchema,
    }),
    user: { modelName: 'authUser' },
    session: {
      modelName: 'authSession',
      expiresIn: 60 * 60 * 24 * 30,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'authAccount',
      encryptOAuthTokens: true,
      accountLinking: { enabled: false, disableImplicitLinking: true },
      storeStateStrategy: 'database',
    },
    verification: { modelName: 'authVerification' },
    databaseHooks: {
      session: {
        create: {
          async before(session, context) {
            if (!context?.path.startsWith('/magic-link/verify')) return;
            const googleAccount = await environment.DB.prepare(
              "SELECT 1 AS found FROM auth_accounts WHERE user_id=? AND provider_id='google' LIMIT 1",
            ).bind(session.userId).first<{ found: number }>();
            if (googleAccount?.found === 1) throw new Error('EMAIL_IDENTITY_COLLISION');

            const now = Date.now();
            await environment.DB.prepare(
              `INSERT OR IGNORE INTO auth_accounts
               (id,account_id,provider_id,user_id,created_at,updated_at)
               VALUES (?,?,'email',?,?,?)`,
            ).bind(crypto.randomUUID(), session.userId, session.userId, now, now).run();
            const emailAccount = await environment.DB.prepare(
              "SELECT user_id FROM auth_accounts WHERE account_id=? AND provider_id='email' LIMIT 1",
            ).bind(session.userId).first<{ user_id: string }>();
            if (emailAccount?.user_id !== session.userId) throw new Error('EMAIL_IDENTITY_PROVENANCE_CONFLICT');
          },
        },
      },
    },
    socialProviders: {
      google: {
        clientId: environment.GOOGLE_CLIENT_ID,
        clientSecret: environment.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      magicLink({
        expiresIn: 600,
        storeToken: 'hashed',
        generateToken: generateMagicLinkToken,
        sendMagicLink: (message) => emailProvider.sendMagicLink(message),
      }),
    ],
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
