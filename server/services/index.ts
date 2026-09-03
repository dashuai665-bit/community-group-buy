import { createId } from '../../domain/ids.ts';
import { maskPhone, sanitizeLogFields } from '../../lib/privacy.ts';
import { ApiError } from '../api-error.ts';
import { Repositories, type ProfileRow } from '../repositories/index.ts';

export interface AuthenticatedProviderIdentity {
  provider: 'phone' | 'line' | 'google' | 'email' | 'chatgpt';
  providerUserId: string;
  verified: boolean;
  email?: string;
}

export interface OrderingPolicy { requireVerifiedPhoneForOrder?: boolean }

export function isProfileComplete(profile: Pick<ProfileRow, 'display_name' | 'phone'>): boolean {
  return Boolean(profile.display_name?.trim() && profile.phone?.trim());
}

export function canProceedToOrdering(profile: Pick<ProfileRow, 'display_name' | 'phone' | 'phone_verified'>, policy: OrderingPolicy = {}): boolean {
  if (!isProfileComplete(profile)) return false;
  return !policy.requireVerifiedPhoneForOrder || profile.phone_verified === 'true';
}

export class IdentityService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }

  async resolveAppUser(identity: AuthenticatedProviderIdentity): Promise<string> {
    if (!identity.verified || !identity.providerUserId.trim()) {
      throw new ApiError(401, 'UNVERIFIED_IDENTITY', '登入身份尚未驗證');
    }
    const existing = await this.repositories.identities.find(identity.provider, identity.providerUserId);
    if (existing) return existing.user_id;

    const userId = createId();
    try {
      await this.repositories.batch([
        this.repositories.users.insertStatement(userId),
        this.repositories.profiles.insertStatement(userId, identity.email ?? null),
        this.repositories.identities.insertStatement(createId(), userId, identity.provider, identity.providerUserId, true),
      ]);
      return userId;
    } catch {
      const winner = await this.repositories.identities.find(identity.provider, identity.providerUserId);
      if (winner) return winner.user_id;
      throw new ApiError(409, 'PROVISIONING_CONFLICT', '建立會員資料時發生衝突');
    }
  }

  async linkIdentityToAuthenticatedUser(userId: string | null, identity: AuthenticatedProviderIdentity): Promise<void> {
    const actor = await requireActiveUser(this.repositories, userId);
    if (!identity.verified || !identity.providerUserId.trim()) throw new ApiError(422, 'INVALID_IDENTITY', '登入身份資料無效');
    const existing = await this.repositories.identities.find(identity.provider, identity.providerUserId);
    if (existing?.user_id === actor.id) return;
    if (existing) throw new ApiError(409, 'IDENTITY_OWNED', '此登入身份已綁定其他會員');
    await this.repositories.batch([
      this.repositories.identities.insertStatement(createId(), actor.id, identity.provider, identity.providerUserId, true),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, actionType: 'identity_link', targetType: 'user_identity' }),
    ]);
  }

  async unlinkIdentity(userId: string | null, identityId: string): Promise<void> {
    const actor = await requireActiveUser(this.repositories, userId);
    const identity = await this.repositories.identities.findById(identityId);
    if (!identity || identity.user_id !== actor.id) throw new ApiError(403, 'IDENTITY_NOT_OWNED', '無權解除此登入身份');
    if (await this.repositories.identities.countForUser(actor.id) <= 1) throw new ApiError(409, 'LAST_IDENTITY', '不可解除最後一個登入身份');
    await this.repositories.batch([
      this.repositories.identities.deleteStatement(identityId),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, actionType: 'identity_unlink', targetType: 'user_identity', targetId: identityId }),
    ]);
  }
}

export async function requireActiveUser(repositories: Repositories, userId: string | null) {
  if (!userId) throw new ApiError(401, 'UNAUTHENTICATED', '請先登入');
  const user = await repositories.users.findById(userId);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', '登入身份無效');
  if (user.status !== 'active') throw new ApiError(403, 'USER_INACTIVE', '會員帳號目前不可執行此操作');
  return user;
}

export class CommunityMembershipService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }

  async join(userId: string | null, communityId: string) {
    const actor = await requireActiveUser(this.repositories, userId);
    const community = await this.repositories.communities.findById(communityId);
    if (!community || community.status !== 'active') throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到可加入的社區');
    const existing = await this.repositories.members.find(actor.id, communityId);
    if (existing?.status === 'active') return { membership: existing, created: false };
    if (community.join_policy === 'approval_required') throw new ApiError(409, 'APPROVAL_REQUIRED', '此社區需要管理員審核');
    if (community.join_policy === 'invite_only') throw new ApiError(403, 'INVITE_REQUIRED', '此社區僅限受邀會員');
    const membershipId = existing?.id ?? createId();
    await this.repositories.batch([
      existing
        ? this.repositories.members.activateStatement(actor.id, communityId)
        : this.repositories.members.insertStatement(membershipId, actor.id, communityId),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'community_join', targetType: 'community', targetId: communityId }),
    ]);
    return { membership: await this.repositories.members.find(actor.id, communityId), created: true };
  }

  async assertCanLeaveCommunity(userId: string, communityId: string): Promise<void> {
    const membership = await this.repositories.members.find(userId, communityId);
    if (!membership || membership.status !== 'active') throw new ApiError(404, 'MEMBERSHIP_NOT_FOUND', '找不到有效 membership');
    if (membership.role === 'community_admin' && await this.repositories.members.countActiveAdmins(communityId) <= 1) {
      throw new ApiError(409, 'LAST_COMMUNITY_ADMIN', '請先移交管理權再離開社區');
    }
    if (await this.repositories.orders.hasUnfinishedForCommunity(userId, communityId)) {
      throw new ApiError(409, 'UNFINISHED_ORDER_OR_PICKUP', '尚有未完成訂單或取貨，暫時無法離開社區');
    }
  }

  async leave(userId: string | null, communityId: string): Promise<void> {
    const actor = await requireActiveUser(this.repositories, userId);
    await this.assertCanLeaveCommunity(actor.id, communityId);
    await this.repositories.batch([
      this.repositories.members.deactivateStatement(actor.id, communityId),
      this.repositories.profiles.reassignDefaultStatement(actor.id, communityId),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'community_leave', targetType: 'community', targetId: communityId }),
    ]);
  }
}

export class CommunityPreferenceService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }
  async setDefault(userId: string | null, communityId: string): Promise<void> {
    const actor = await requireActiveUser(this.repositories, userId);
    const community = await this.repositories.communities.findById(communityId);
    if (!community || community.status !== 'active') throw new ApiError(422, 'INVALID_DEFAULT_COMMUNITY', '預設社區必須為啟用狀態');
    const membership = await this.repositories.members.find(actor.id, communityId);
    if (!membership || membership.status !== 'active') throw new ApiError(422, 'ACTIVE_MEMBERSHIP_REQUIRED', '必須先加入該社區');
    await this.repositories.batch([
      this.repositories.profiles.setDefaultStatement(actor.id, communityId),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'default_community_change', targetType: 'user_profile', targetId: actor.id }),
    ]);
  }
  switchBrowsingCommunity(current: string | null, communityId: string): string {
    void current;
    return communityId;
  }
}

export class CommunityAdminService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }
  async getMemberContact(actorUserId: string | null, communityId: string, targetUserId: string) {
    const actor = await requireActiveUser(this.repositories, actorUserId);
    const platformAdmin = await this.repositories.platformRoles.isPlatformAdmin(actor.id);
    const membership = await this.repositories.members.find(actor.id, communityId);
    if (!platformAdmin && (membership?.status !== 'active' || membership.role !== 'community_admin')) {
      throw new ApiError(403, 'COMMUNITY_ADMIN_REQUIRED', '無權查看此社區會員聯絡資料');
    }
    const contact = await this.repositories.members.findActiveTargetContact(targetUserId, communityId);
    if (!contact) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到該社區會員');
    await this.repositories.batch([this.repositories.audits.insertStatement({
      id: createId(), actorUserId: actor.id, communityId, actionType: 'admin_member_contact_access',
      targetType: 'user', targetId: targetUserId,
      metadata: sanitizeLogFields({ phone: contact.phone ? maskPhone(contact.phone) : null }),
    })]);
    return { displayName: contact.display_name, phone: contact.phone, phoneVerified: contact.phone_verified === 'true' };
  }
}

export class ProfileService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }
  async changePhone(userId: string | null, phone: string): Promise<void> {
    const actor = await requireActiveUser(this.repositories, userId);
    await this.repositories.batch([this.repositories.profiles.changePhoneStatement(actor.id, phone)]);
  }
}
