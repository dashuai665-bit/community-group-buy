import { DomainError } from './errors.ts';
import { createId } from './ids.ts';
import type { IdentityProvider, UserIdentity, UserProfile } from './types.ts';

export interface IdentityRepository {
  findIdentity(provider: IdentityProvider, providerUserId: string): Promise<UserIdentity | null>;
  getIdentity(identityId: string): Promise<UserIdentity | null>;
  createIdentity(identity: UserIdentity): Promise<void>;
  countLoginIdentities(userId: string): Promise<number>;
  removeIdentity(identityId: string): Promise<void>;
}

export async function unlinkIdentity(
  repository: IdentityRepository,
  authenticatedUserId: string,
  identityId: string,
): Promise<void> {
  const identity = await repository.getIdentity(identityId);
  if (!identity || identity.userId !== authenticatedUserId) {
    throw new DomainError('IDENTITY_NOT_OWNED', '只能解除自己的登入身份');
  }
  if ((await repository.countLoginIdentities(authenticatedUserId)) <= 1) {
    throw new DomainError('LAST_LOGIN_IDENTITY', '不可解除最後一個可登入身份');
  }
  await repository.removeIdentity(identityId);
}

export async function linkIdentityFromAuthenticatedSession(
  repository: IdentityRepository,
  authenticatedUserId: string,
  input: { provider: IdentityProvider; providerUserId: string; verified: boolean; metadata?: Record<string, unknown> },
): Promise<UserIdentity> {
  if (await repository.findIdentity(input.provider, input.providerUserId)) {
    throw new DomainError('IDENTITY_EXISTS', '此登入身份已綁定其他帳號');
  }
  const identity: UserIdentity = {
    id: createId(),
    userId: authenticatedUserId,
    provider: input.provider,
    providerUserId: input.providerUserId,
    verified: input.verified,
    metadata: input.metadata ?? null,
  };
  await repository.createIdentity(identity);
  return identity;
}

export function completeProfileAfterExternalLogin(profile: UserProfile, manuallyEnteredPhone: string): UserProfile {
  return { ...profile, phone: manuallyEnteredPhone, phoneVerified: false };
}

export function applyPhoneOtpVerification(profile: UserProfile, verifiedPhone: string): UserProfile {
  return { ...profile, phone: verifiedPhone, phoneVerified: true };
}

export function changeProfilePhone(profile: UserProfile, nextPhone: string): UserProfile {
  if (profile.phone === nextPhone) return profile;
  return { ...profile, phone: nextPhone, phoneVerified: false };
}
