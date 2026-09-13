import type { ProductionAuth } from './better-auth.ts';
import { EmailDeliveryUnavailableError } from './email-provider.ts';
import { emailContinuationPath, safeReturnTo } from './redirect.ts';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvalidEmailRequestError extends Error {}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidEmailRequestError('email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new InvalidEmailRequestError('email is invalid');
  }
  return email;
}

export interface EmailMagicLinkRepository {
  hasGoogleAccountForEmail(email: string): Promise<boolean>;
}

export class D1EmailMagicLinkRepository implements EmailMagicLinkRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async hasGoogleAccountForEmail(email: string): Promise<boolean> {
    const row = await this.database
      .prepare(
        `SELECT 1 AS found
         FROM auth_users u
         JOIN auth_accounts a ON a.user_id = u.id
         WHERE u.email = ? AND a.provider_id = 'google'
         LIMIT 1`,
      )
      .bind(email)
      .first<{ found: number }>();
    return row?.found === 1;
  }
}

export class EmailMagicLinkService {
  private readonly auth: ProductionAuth;
  private readonly repository: EmailMagicLinkRepository;

  constructor(
    auth: ProductionAuth,
    repository: EmailMagicLinkRepository,
  ) {
    this.auth = auth;
    this.repository = repository;
  }

  async request(input: { email: unknown; returnTo?: unknown }, headers: Headers) {
    const email = normalizeEmail(input.email);
    const returnTo = safeReturnTo(typeof input.returnTo === 'string' ? input.returnTo : undefined);

    if (await this.repository.hasGoogleAccountForEmail(email)) return { ok: true as const };

    try {
      await this.auth.api.signInMagicLink({
        body: {
          email,
          callbackURL: emailContinuationPath(returnTo),
          errorCallbackURL: '/',
        },
        headers,
      });
    } catch (error) {
      if (!(error instanceof EmailDeliveryUnavailableError)) throw error;
    }
    return { ok: true as const };
  }
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite !== 'cross-site' && (!origin || origin === new URL(request.url).origin);
}

export async function handleEmailMagicLinkRequest(
  request: Request,
  service: EmailMagicLinkService,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const input = body as Record<string, unknown>;
    return Response.json(
      await service.request(
        { email: input.email, returnTo: input.returnTo },
        request.headers,
      ),
    );
  } catch (error) {
    if (error instanceof InvalidEmailRequestError) {
      return Response.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
    }
    throw error;
  }
}
