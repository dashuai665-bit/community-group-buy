export type UserStatus = 'active' | 'suspended' | 'deleted';
export type CommunityStatus = 'active' | 'inactive';
export type JoinPolicy = 'open' | 'approval_required' | 'invite_only';
export type MembershipRole = 'resident' | 'community_admin';
export type MembershipStatus = 'active' | 'inactive';
export type IdentityProvider = 'phone' | 'line' | 'google' | 'email' | 'chatgpt';

export interface User { id: string; status: UserStatus }
export interface UserProfile {
  userId: string;
  displayName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  defaultCommunityId: string | null;
}
export interface Community { id: string; name: string; status: CommunityStatus; joinPolicy: JoinPolicy }
export interface CommunityMembership {
  id: string;
  userId: string;
  communityId: string;
  role: MembershipRole;
  status: MembershipStatus;
}
export interface UserIdentity {
  id: string;
  userId: string;
  provider: IdentityProvider;
  providerUserId: string;
  verified: boolean;
  metadata: Record<string, unknown> | null;
}
export interface BrowsingCommunityContext { userId: string; browsingCommunityId: string | null }
