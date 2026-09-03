import { DomainError } from './errors.ts';
import { createId } from './ids.ts';
import type { BrowsingCommunityContext, Community, CommunityMembership, User } from './types.ts';

export interface LeaveBlockers { unfinishedOrders: boolean; unfinishedPickups: boolean }

export interface CommunityRepository {
  getUser(userId: string): Promise<User | null>;
  getCommunity(communityId: string): Promise<Community | null>;
  getMembership(userId: string, communityId: string): Promise<CommunityMembership | null>;
  listActiveMemberships(userId: string): Promise<Array<{ membership: CommunityMembership; community: Community }>>;
  createMembership(membership: CommunityMembership): Promise<void>;
  removeMembership(userId: string, communityId: string): Promise<void>;
  getDefaultCommunityId(userId: string): Promise<string | null>;
  setDefaultCommunityId(userId: string, communityId: string | null): Promise<void>;
  getLeaveBlockers(userId: string, communityId: string): Promise<LeaveBlockers>;
}

async function assertActiveUser(repository: CommunityRepository, userId: string): Promise<void> {
  const user = await repository.getUser(userId);
  if (!user || user.status !== 'active') {
    throw new DomainError('USER_INACTIVE', '使用者不存在或非啟用狀態');
  }
}

async function assertActiveCommunity(repository: CommunityRepository, communityId: string): Promise<Community> {
  const community = await repository.getCommunity(communityId);
  if (!community || community.status !== 'active') {
    throw new DomainError('COMMUNITY_INACTIVE', '社區不存在或非啟用狀態');
  }
  return community;
}

export async function joinCommunity(repository: CommunityRepository, userId: string, communityId: string): Promise<CommunityMembership> {
  await assertActiveUser(repository, userId);
  const community = await assertActiveCommunity(repository, communityId);
  if (await repository.getMembership(userId, communityId)) {
    throw new DomainError('MEMBERSHIP_EXISTS', '使用者已加入此社區');
  }
  if (community.joinPolicy === 'approval_required') {
    throw new DomainError('JOIN_REQUIRES_APPROVAL', '此社區需要審核');
  }
  if (community.joinPolicy === 'invite_only') {
    throw new DomainError('JOIN_REQUIRES_INVITE', '此社區僅限受邀加入');
  }
  const membership: CommunityMembership = {
    id: createId(), userId, communityId, role: 'resident', status: 'active',
  };
  await repository.createMembership(membership);
  return membership;
}

export async function setDefaultCommunity(repository: CommunityRepository, userId: string, communityId: string): Promise<void> {
  await assertActiveUser(repository, userId);
  await assertActiveCommunity(repository, communityId);
  const membership = await repository.getMembership(userId, communityId);
  if (!membership || membership.status !== 'active') {
    throw new DomainError('MEMBERSHIP_REQUIRED', '預設社區必須是有效 membership');
  }
  await repository.setDefaultCommunityId(userId, communityId);
}

export async function switchBrowsingCommunity(
  repository: CommunityRepository,
  context: BrowsingCommunityContext,
  communityId: string,
): Promise<BrowsingCommunityContext> {
  await assertActiveCommunity(repository, communityId);
  const membership = await repository.getMembership(context.userId, communityId);
  if (!membership || membership.status !== 'active') {
    throw new DomainError('MEMBERSHIP_REQUIRED', '只能瀏覽已加入的有效社區');
  }
  return { ...context, browsingCommunityId: communityId };
}

export async function leaveCommunity(repository: CommunityRepository, userId: string, communityId: string): Promise<void> {
  const membership = await repository.getMembership(userId, communityId);
  if (!membership || membership.status !== 'active') {
    throw new DomainError('MEMBERSHIP_REQUIRED', '找不到有效 membership');
  }
  const blockers = await repository.getLeaveBlockers(userId, communityId);
  if (blockers.unfinishedOrders || blockers.unfinishedPickups) {
    throw new DomainError('LEAVE_BLOCKED', '尚有未完成訂單或取貨，不能離開社區');
  }
  const defaultCommunityId = await repository.getDefaultCommunityId(userId);
  const alternatives = (await repository.listActiveMemberships(userId)).filter(
    ({ membership: item, community }) => item.communityId !== communityId && item.status === 'active' && community.status === 'active',
  );
  if (defaultCommunityId === communityId) {
    await repository.setDefaultCommunityId(userId, alternatives[0]?.community.id ?? null);
  }
  await repository.removeMembership(userId, communityId);
}
