import { createId } from './ids.ts';
import type { User, UserProfile } from './types.ts';

export interface RegistrationRepository {
  createUser(user: User, profile: UserProfile): Promise<void>;
}

export async function createUserAccount(
  repository: RegistrationRepository,
  input: { displayName?: string; phone?: string; email?: string },
): Promise<{ user: User; profile: UserProfile }> {
  const user: User = { id: createId(), status: 'active' };
  const profile: UserProfile = {
    userId: user.id,
    displayName: input.displayName ?? null,
    phone: input.phone ?? null,
    phoneVerified: false,
    email: input.email ?? null,
    emailVerified: false,
    defaultCommunityId: null,
  };
  await repository.createUser(user, profile);
  return { user, profile };
}
