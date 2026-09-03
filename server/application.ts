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
import {
  CommunityOfferingService,
  GroupBuyBatchService,
  ProductCatalogService,
  ProductWishService,
  type OfferingStatus,
  type WishStatus,
} from './services/catalog.ts';
import { OrderService, PickupService } from './services/orders.ts';
import { AdminOperationsService } from './services/admin-operations.ts';

export interface AuthenticationAdapter {
  authenticate(request: Request): Promise<AuthenticatedProviderIdentity | null>;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function validateId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !idPattern.test(value))
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} 格式不正確`);
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
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(422, 'VALIDATION_ERROR', '請提供有效的 JSON object');
  }
}

function validateText(value: unknown, field: string, maximum = 500): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > maximum
  ) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} 格式不正確`);
  }
  return value.trim();
}

function validatePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} 必須是正整數`);
  return Number(value);
}

function validateOptionalPositiveInteger(
  value: unknown,
  field: string,
): number | null {
  return value === undefined || value === null
    ? null
    : validatePositiveInteger(value, field);
}

export function createApplication(
  repositories: Repositories,
  authentication: AuthenticationAdapter,
) {
  const identities = new IdentityService(repositories);
  const memberships = new CommunityMembershipService(repositories);
  const preferences = new CommunityPreferenceService(repositories);
  const admin = new CommunityAdminService(repositories);
  const profiles = new ProfileService(repositories);
  const products = new ProductCatalogService(repositories);
  const offerings = new CommunityOfferingService(repositories);
  const batches = new GroupBuyBatchService(repositories);
  const wishes = new ProductWishService(repositories);
  const orders = new OrderService(repositories);
  const pickups = new PickupService(repositories);
  const operations = new AdminOperationsService(repositories);

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
        return Response.json({
          communities: rows.map(
            ({ id, name, slug, status, join_policy: joinPolicy }) => ({
              id,
              name,
              slug,
              status,
              joinPolicy,
            }),
          ),
        });
      }
      if (request.method === 'GET' && path === '/api/admin/communities') {
        const result = await admin.listManageableCommunities(
          await appUser(request),
        );
        return Response.json({
          isPlatformAdmin: result.isPlatformAdmin,
          communities: result.communities.map((community) => ({
            id: community.id,
            name: community.name,
            slug: community.slug,
            status: community.status,
            joinPolicy: community.join_policy,
          })),
        });
      }
      if (request.method === 'GET' && path === '/api/admin/summary')
        return Response.json(
          await operations.dashboard(await appUser(request)),
        );
      const operationsMatch = path.match(
        /^\/api\/admin\/communities\/([^/]+)\/summary$/,
      );
      if (request.method === 'GET' && operationsMatch)
        return Response.json(
          await operations.community(
            await appUser(request),
            validateId(operationsMatch[1], 'communityId'),
          ),
        );
      if (request.method === 'GET' && path === '/api/me/communities') {
        const userId = await appUser(request);
        const actor = await requireActiveUser(repositories, userId);
        const profile = await repositories.profiles.findByUserId(actor.id);
        const rows = (await repositories.members.listActiveForUser(
          actor.id,
        )) as Array<Record<string, unknown>>;
        return Response.json({
          memberships: rows.map((row) => ({
            community: {
              id: row.community_id,
              name: row.name,
              slug: row.slug,
              status: row.community_status,
              joinPolicy: row.join_policy,
            },
            role: row.role,
            isDefault: row.community_id === profile?.default_community_id,
          })),
        });
      }
      if (request.method === 'POST' && path === '/api/orders') {
        const body = await readObject(request);
        const key =
          typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key))
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'idempotencyKey 格式或長度不正確',
          );
        if (
          !Array.isArray(body.items) ||
          body.items.length === 0 ||
          body.items.length > 50
        )
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'items 必須包含 1 至 50 個品項',
          );
        const items = body.items.map((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new ApiError(422, 'VALIDATION_ERROR', 'item 格式不正確');
          const item = value as Record<string, unknown>;
          return {
            offeringId: validateId(item.offeringId, 'offeringId'),
            quantity: validatePositiveInteger(item.quantity, 'quantity'),
          };
        });
        const result = await orders.create(await appUser(request), {
          communityId: validateId(body.communityId, 'communityId'),
          idempotencyKey: key,
          items,
        });
        return Response.json(result, { status: result.created ? 201 : 200 });
      }
      if (request.method === 'GET' && path === '/api/orders')
        return Response.json({
          orders: await orders.listMine(await appUser(request)),
        });
      let orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
      if (request.method === 'GET' && orderMatch)
        return Response.json({
          order: await orders.getMine(
            await appUser(request),
            validateId(orderMatch[1], 'orderId'),
          ),
        });
      orderMatch = path.match(/^\/api\/orders\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && orderMatch) {
        const body = await readObject(request);
        const reason = validateText(body.reason, 'reason', 500);
        return Response.json({
          order: await orders.cancel(
            await appUser(request),
            validateId(orderMatch[1], 'orderId'),
            reason,
          ),
        });
      }
      let adminOrderMatch = path.match(
        /^\/api\/admin\/communities\/([^/]+)\/orders(?:\/([^/]+))?$/,
      );
      if (request.method === 'GET' && adminOrderMatch && !adminOrderMatch[2])
        return Response.json({
          orders: await orders.listCommunity(
            await appUser(request),
            validateId(adminOrderMatch[1], 'communityId'),
          ),
        });
      if (request.method === 'GET' && adminOrderMatch?.[2])
        return Response.json({
          order: await orders.getCommunity(
            await appUser(request),
            validateId(adminOrderMatch[1], 'communityId'),
            validateId(adminOrderMatch[2], 'orderId'),
          ),
        });
      adminOrderMatch = path.match(
        /^\/api\/admin\/communities\/([^/]+)\/orders\/([^/]+)\/(cancel|ready|pickup\/complete)$/,
      );
      if (request.method === 'POST' && adminOrderMatch) {
        const communityId = validateId(adminOrderMatch[1], 'communityId'),
          orderId = validateId(adminOrderMatch[2], 'orderId');
        if (adminOrderMatch[3] === 'cancel') {
          const body = await readObject(request);
          return Response.json({
            order: await orders.cancel(
              await appUser(request),
              orderId,
              validateText(body.reason, 'reason', 500),
              communityId,
            ),
          });
        }
        if (adminOrderMatch[3] === 'ready')
          return Response.json({
            pickup: await pickups.markReady(
              await appUser(request),
              communityId,
              orderId,
            ),
          });
        return Response.json({
          pickup: await pickups.complete(
            await appUser(request),
            communityId,
            orderId,
          ),
        });
      }
      if (request.method === 'POST' && path === '/api/admin/products') {
        const body = await readObject(request);
        const sourceType = String(body.sourceType);
        if (
          !['manual', 'costco', 'supplier', 'overseas', 'other'].includes(
            sourceType,
          )
        )
          throw new ApiError(422, 'VALIDATION_ERROR', 'sourceType 不正確');
        const product = await products.create(await appUser(request), {
          name: validateText(body.name, 'name', 120),
          description:
            body.description == null
              ? null
              : validateText(body.description, 'description', 2000),
          sourceType,
          sourceReference:
            body.sourceReference == null
              ? null
              : validateText(body.sourceReference, 'sourceReference', 500),
          unitLabel: validateText(body.unitLabel, 'unitLabel', 40),
          imageUrl:
            body.imageUrl == null
              ? null
              : validateText(body.imageUrl, 'imageUrl', 1000),
        });
        return Response.json({ product }, { status: 201 });
      }
      const productMatch = path.match(
        /^\/api\/communities\/([^/]+)\/products(?:\/([^/]+))?$/,
      );
      if (request.method === 'GET' && productMatch) {
        const communityId = validateId(productMatch[1], 'communityId');
        const community = await repositories.communities.findById(communityId);
        if (!community || community.status !== 'active')
          throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
        if (productMatch[2]) {
          const offering = await repositories.offerings.findPublicScoped(
            communityId,
            validateId(productMatch[2], 'offeringId'),
          );
          if (!offering)
            throw new ApiError(404, 'OFFERING_NOT_FOUND', '找不到此社區商品');
          return Response.json({ offering });
        }
        return Response.json({
          offerings: await repositories.offerings.listPublic(communityId),
        });
      }
      const offeringMatch = path.match(
        /^\/api\/admin\/communities\/([^/]+)\/offerings(?:\/([^/]+))?$/,
      );
      if (request.method === 'POST' && offeringMatch && !offeringMatch[2]) {
        const body = await readObject(request);
        const minQuantity = validatePositiveInteger(
          body.minQuantity,
          'minQuantity',
        );
        const maxQuantity = validateOptionalPositiveInteger(
          body.maxQuantity,
          'maxQuantity',
        );
        if (maxQuantity !== null && minQuantity > maxQuantity)
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'minQuantity 不可大於 maxQuantity',
          );
        const offering = await offerings.create(
          await appUser(request),
          validateId(offeringMatch[1], 'communityId'),
          {
            productId: validateId(body.productId, 'productId'),
            priceMinor: validatePositiveInteger(body.priceMinor, 'priceMinor'),
            batchThreshold: validatePositiveInteger(
              body.batchThreshold,
              'batchThreshold',
            ),
            minQuantity,
            maxQuantity,
          },
        );
        return Response.json({ offering }, { status: 201 });
      }
      if (request.method === 'PATCH' && offeringMatch?.[2]) {
        const body = await readObject(request);
        const status = String(body.status);
        if (!['active', 'paused', 'ended'].includes(status))
          throw new ApiError(422, 'VALIDATION_ERROR', 'status 不正確');
        const minQuantity = validatePositiveInteger(
          body.minQuantity,
          'minQuantity',
        );
        const maxQuantity = validateOptionalPositiveInteger(
          body.maxQuantity,
          'maxQuantity',
        );
        if (maxQuantity !== null && minQuantity > maxQuantity)
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'minQuantity 不可大於 maxQuantity',
          );
        const offering = await offerings.update(
          await appUser(request),
          validateId(offeringMatch[1], 'communityId'),
          validateId(offeringMatch[2], 'offeringId'),
          {
            priceMinor: validatePositiveInteger(body.priceMinor, 'priceMinor'),
            batchThreshold: validatePositiveInteger(
              body.batchThreshold,
              'batchThreshold',
            ),
            minQuantity,
            maxQuantity,
            status: status as OfferingStatus,
          },
        );
        return Response.json({ offering });
      }
      const commitmentMatch = path.match(
        /^\/api\/communities\/([^/]+)\/offerings\/([^/]+)\/commitments$/,
      );
      if (request.method === 'POST' && commitmentMatch) {
        const body = await readObject(request);
        const result = await batches.commitQuantity(
          await appUser(request),
          validateId(commitmentMatch[1], 'communityId'),
          validateId(commitmentMatch[2], 'offeringId'),
          validatePositiveInteger(body.quantity, 'quantity'),
          body.idempotencyKey === undefined
            ? undefined
            : validateId(body.idempotencyKey, 'idempotencyKey'),
        );
        return Response.json({ batches: result }, { status: 201 });
      }
      const wishCreateMatch = path.match(
        /^\/api\/communities\/([^/]+)\/wishes$/,
      );
      if (request.method === 'POST' && wishCreateMatch) {
        const body = await readObject(request);
        const wish = await wishes.create(
          await appUser(request),
          validateId(wishCreateMatch[1], 'communityId'),
          {
            productId:
              body.productId == null
                ? null
                : validateId(body.productId, 'productId'),
            wishText:
              body.wishText == null
                ? null
                : validateText(body.wishText, 'wishText', 500),
          },
        );
        return Response.json({ wish }, { status: 201 });
      }
      if (request.method === 'GET' && path === '/api/me/wishes')
        return Response.json({
          wishes: await wishes.listMine(await appUser(request)),
        });
      const adminWishesMatch = path.match(
        /^\/api\/admin\/communities\/([^/]+)\/wishes(?:\/([^/]+))?$/,
      );
      if (request.method === 'GET' && adminWishesMatch && !adminWishesMatch[2])
        return Response.json({
          wishes: await wishes.listCommunity(
            await appUser(request),
            validateId(adminWishesMatch[1], 'communityId'),
          ),
        });
      if (request.method === 'PATCH' && adminWishesMatch?.[2]) {
        const body = await readObject(request);
        const status = String(body.status);
        if (!['open', 'reviewing', 'fulfilled', 'rejected'].includes(status))
          throw new ApiError(422, 'VALIDATION_ERROR', 'status 不正確');
        const wish = await wishes.updateStatus(
          await appUser(request),
          validateId(adminWishesMatch[1], 'communityId'),
          validateId(adminWishesMatch[2], 'wishId'),
          status as WishStatus,
        );
        return Response.json({ wish });
      }
      let match = path.match(/^\/api\/communities\/([^/]+)\/(join|leave)$/);
      if (request.method === 'POST' && match) {
        const userId = await appUser(request);
        const communityId = validateId(match[1], 'communityId');
        if (match[2] === 'join') {
          const result = await memberships.join(userId, communityId);
          return Response.json(
            { created: result.created, membership: result.membership },
            { status: result.created ? 201 : 200 },
          );
        }
        await memberships.leave(userId, communityId);
        return Response.json({ success: true });
      }
      if (request.method === 'PUT' && path === '/api/me/default-community') {
        const userId = await appUser(request);
        const body = await readObject(request);
        await preferences.setDefault(
          userId,
          validateId(body.communityId, 'communityId'),
        );
        return Response.json({ success: true });
      }
      if (request.method === 'POST' && path === '/api/me/identities/link') {
        const userId = await appUser(request);
        const body = await readObject(request);
        const provider = body.provider;
        if (
          !['phone', 'line', 'google', 'email', 'chatgpt'].includes(
            String(provider),
          )
        )
          throw new ApiError(422, 'VALIDATION_ERROR', 'provider 不正確');
        await identities.linkIdentityToAuthenticatedUser(userId, {
          provider: provider as AuthenticatedProviderIdentity['provider'],
          providerUserId: validateProviderUserId(body.providerUserId),
          verified: body.verified === true,
          email: typeof body.email === 'string' ? body.email : undefined,
        });
        return Response.json({ success: true });
      }
      if (request.method === 'GET' && path === '/api/me/profile') {
        const actor = await requireActiveUser(
          repositories,
          await appUser(request),
        );
        const profile = await repositories.profiles.findByUserId(actor.id);
        if (!profile)
          throw new ApiError(404, 'PROFILE_NOT_FOUND', '找不到會員資料');
        return Response.json({
          profile: {
            displayName: profile.display_name,
            phone: profile.phone,
            phoneVerified: profile.phone_verified === 'true',
            email: profile.email,
            defaultCommunityId: profile.default_community_id,
          },
          isPlatformAdmin: await repositories.platformRoles.isPlatformAdmin(
            actor.id,
          ),
        });
      }
      match = path.match(/^\/api\/me\/identities\/([^/]+)\/unlink$/);
      if (request.method === 'POST' && match) {
        await identities.unlinkIdentity(
          await appUser(request),
          validateId(match[1], 'identityId'),
        );
        return Response.json({ success: true });
      }
      if (request.method === 'PUT' && path === '/api/me/profile/display-name') {
        const body = await readObject(request);
        const displayName = validateText(body.displayName, 'displayName', 80);
        await profiles.changeDisplayName(await appUser(request), displayName);
        return Response.json({ success: true });
      }
      if (request.method === 'PUT' && path === '/api/me/profile/phone') {
        const body = await readObject(request);
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        if (!/^0[0-9]{8,9}$/.test(phone))
          throw new ApiError(422, 'VALIDATION_ERROR', 'phone 格式不正確');
        await profiles.changePhone(await appUser(request), phone);
        return Response.json({ success: true });
      }
      match = path.match(
        /^\/api\/admin\/communities\/([^/]+)\/members\/([^/]+)\/contact$/,
      );
      if (request.method === 'GET' && match) {
        const contact = await admin.getMemberContact(
          await appUser(request),
          validateId(match[1], 'communityId'),
          validateId(match[2], 'userId'),
        );
        return Response.json({ contact });
      }
      throw new ApiError(404, 'ROUTE_NOT_FOUND', '找不到此 API');
    } catch (error) {
      return errorResponse(error);
    }
  };
}
