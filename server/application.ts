import { ApiError, errorResponse } from './api-error.ts';
import { Repositories } from './repositories/index.ts';
import {
  CommunityAdminService,
  CommunityMembershipService,
  CommunityPreferenceService,
  IdentityService,
  ProfileService,
  requireActiveUser,
  type AuthenticatedProviderIdentity,
} from './services/index.ts';

export interface AuthenticationAdapter {
  authenticate(request: Request): Promise<AuthenticatedProviderIdentity | null>;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function validateId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new ApiError(422, 'VALIDATION_ERROR', `${field} 格式不正確`);
  return value;
}
function validateProviderUserId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 255 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'providerUserId 格式不正確');
  }
  return value;
}
async function readObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(422, 'VALIDATION_ERROR', '請提供有效的 JSON object');
  }
}

export function createApplication(repositories: Repositories, authentication: AuthenticationAdapter) {
  const identities = new IdentityService(repositories);
  const memberships = new CommunityMembershipService(repositories);
  const preferences = new CommunityPreferenceService(repositories);
  const admin = new CommunityAdminService(repositories);
  const profiles = new ProfileService(repositories);

  async function appUser(request: Request): Promise<string | null> {
    const identity = await authentication.authenticate(request);
    return identity ? identities.resolveAppUser(identity) : null;
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === 'GET' && path === '/api/communities') {
        const rows = await repositories.communities.listActive();
        return Response.json({ communities: rows.map(({ id, name, slug, status, join_policy: joinPolicy }) => ({ id, name, slug, status, joinPolicy })) });
      }
      if (request.method === 'GET' && path === '/api/me/communities') {
        const userId = await appUser(request);
        const actor = await requireActiveUser(repositories, userId);
        const profile = await repositories.profiles.findByUserId(actor.id);
        const rows = await repositories.members.listActiveForUser(actor.id) as Array<Record<string, unknown>>;
        return Response.json({ memberships: rows.map((row) => ({
          community: { id: row.community_id, name: row.name, slug: row.slug, status: row.community_status, joinPolicy: row.join_policy },
          role: row.role, isDefault: row.community_id === profile?.default_community_id,
        })) });
      }
      let match = path.match(/^\/api\/communities\/([^/]+)\/(join|leave)$/);
      if (request.method === 'POST' && match) {
        const userId = await appUser(request);
        const communityId = validateId(match[1], 'communityId');
        if (match[2] === 'join') {
          const result = await memberships.join(userId, communityId);
          return Response.json({ created: result.created, membership: result.membership }, { status: result.created ? 201 : 200 });
        }
        await memberships.leave(userId, communityId);
        return Response.json({ success: true });
      }
      if (request.method === 'PUT' && path === '/api/me/default-community') {
        const userId = await appUser(request);
        const body = await readObject(request);
        await preferences.setDefault(userId, validateId(body.communityId, 'communityId'));
        return Response.json({ success: true });
      }
      if (request.method === 'POST' && path === '/api/me/identities/link') {
        const userId = await appUser(request);
        const body = await readObject(request);
        const provider = body.provider;
        if (!['phone', 'line', 'google', 'email', 'chatgpt'].includes(String(provider))) throw new ApiError(422, 'VALIDATION_ERROR', 'provider 不正確');
        await identities.linkIdentityToAuthenticatedUser(userId, {
          provider: provider as AuthenticatedProviderIdentity['provider'],
          providerUserId: validateProviderUserId(body.providerUserId),
          verified: body.verified === true,
          email: typeof body.email === 'string' ? body.email : undefined,
        });
        return Response.json({ success: true });
      }
      match = path.match(/^\/api\/me\/identities\/([^/]+)\/unlink$/);
      if (request.method === 'POST' && match) {
        await identities.unlinkIdentity(await appUser(request), validateId(match[1], 'identityId'));
        return Response.json({ success: true });
      }
      if (request.method === 'PUT' && path === '/api/me/profile/phone') {
        const body = await readObject(request);
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        if (!/^0[0-9]{8,9}$/.test(phone)) throw new ApiError(422, 'VALIDATION_ERROR', 'phone 格式不正確');
        await profiles.changePhone(await appUser(request), phone);
        return Response.json({ success: true });
      }
      match = path.match(/^\/api\/admin\/communities\/([^/]+)\/members\/([^/]+)\/contact$/);
      if (request.method === 'GET' && match) {
        const contact = await admin.getMemberContact(await appUser(request), validateId(match[1], 'communityId'), validateId(match[2], 'userId'));
        return Response.json({ contact });
      }
      throw new ApiError(404, 'ROUTE_NOT_FOUND', '找不到此 API');
    } catch (error) {
      return errorResponse(error);
    }
  };
}
