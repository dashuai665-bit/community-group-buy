import { DomainError } from './errors.ts';
import type { CommunityMembership, User } from './types.ts';

export interface AuthorizationRepository {
  getUser(userId: string): Promise<User | null>;
  getMembership(userId: string, communityId: string): Promise<CommunityMembership | null>;
  hasPlatformRole(userId: string, role: 'platform_admin'): Promise<boolean>;
}

export function requireAuthenticatedUser(userId: string | null): string {
  if (!userId) throw new DomainError('AUTHENTICATION_REQUIRED', '必須先登入');
  return userId;
}

export async function requireActiveUser(repository: AuthorizationRepository, userId: string | null): Promise<User> {
  const authenticatedUserId = requireAuthenticatedUser(userId);
  const user = await repository.getUser(authenticatedUserId);
  if (!user || user.status !== 'active') {
    throw new DomainError('USER_INACTIVE', '使用者不存在或非啟用狀態');
  }
  return user;
}

export async function requireCommunityMember(
  repository: AuthorizationRepository,
  userId: string | null,
  communityId: string,
): Promise<CommunityMembership> {
  const user = await requireActiveUser(repository, userId);
  const membership = await repository.getMembership(user.id, communityId);
  if (!membership || membership.status !== 'active') {
    throw new DomainError('MEMBERSHIP_REQUIRED', '需要有效的社區 membership');
  }
  return membership;
}

export async function requireCommunityAdmin(
  repository: AuthorizationRepository,
  userId: string | null,
  communityId: string,
): Promise<CommunityMembership> {
  const membership = await requireCommunityMember(repository, userId, communityId);
  if (membership.role !== 'community_admin') {
    throw new DomainError('COMMUNITY_ADMIN_REQUIRED', '需要該社區管理員權限');
  }
  return membership;
}

export async function requirePlatformAdmin(repository: AuthorizationRepository, userId: string | null): Promise<User> {
  const user = await requireActiveUser(repository, userId);
  if (!(await repository.hasPlatformRole(user.id, 'platform_admin'))) {
    throw new DomainError('PLATFORM_ADMIN_REQUIRED', '需要平台管理員權限');
  }
  return user;
}

export async function canManageCommunity(
  repository: AuthorizationRepository,
  userId: string | null,
  communityId: string,
): Promise<boolean> {
  try {
    const user = await requireActiveUser(repository, userId);
    if (await repository.hasPlatformRole(user.id, 'platform_admin')) return true;
    const membership = await repository.getMembership(user.id, communityId);
    return membership?.status === 'active' && membership.role === 'community_admin';
  } catch (error) {
    if (error instanceof DomainError) return false;
    throw error;
  }
}
