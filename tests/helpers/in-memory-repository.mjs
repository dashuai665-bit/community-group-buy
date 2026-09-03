export class InMemoryRepository {
  users = new Map();
  profiles = new Map();
  communities = new Map();
  memberships = new Map();
  identities = new Map();
  platformAdmins = new Set();
  leaveBlockers = new Map();

  membershipKey(userId, communityId) { return `${userId}:${communityId}`; }
  identityKey(provider, providerUserId) { return `${provider}:${providerUserId}`; }

  async createUser(user, profile) {
    this.users.set(user.id, user);
    this.profiles.set(user.id, profile);
  }
  async getUser(userId) { return this.users.get(userId) ?? null; }
  async getCommunity(communityId) { return this.communities.get(communityId) ?? null; }
  async getMembership(userId, communityId) {
    return this.memberships.get(this.membershipKey(userId, communityId)) ?? null;
  }
  async listActiveMemberships(userId) {
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId && membership.status === 'active')
      .map((membership) => ({ membership, community: this.communities.get(membership.communityId) }))
      .filter(({ community }) => community);
  }
  async createMembership(membership) {
    const key = this.membershipKey(membership.userId, membership.communityId);
    if (this.memberships.has(key)) throw new Error('UNIQUE membership');
    this.memberships.set(key, membership);
  }
  async removeMembership(userId, communityId) {
    this.memberships.delete(this.membershipKey(userId, communityId));
  }
  async getDefaultCommunityId(userId) {
    return this.profiles.get(userId)?.defaultCommunityId ?? null;
  }
  async setDefaultCommunityId(userId, communityId) {
    const profile = this.profiles.get(userId);
    this.profiles.set(userId, { ...profile, defaultCommunityId: communityId });
  }
  async getLeaveBlockers(userId, communityId) {
    return this.leaveBlockers.get(this.membershipKey(userId, communityId)) ?? {
      unfinishedOrders: false,
      unfinishedPickups: false,
    };
  }
  async hasPlatformRole(userId, role) {
    return role === 'platform_admin' && this.platformAdmins.has(userId);
  }
  async findIdentity(provider, providerUserId) {
    return this.identities.get(this.identityKey(provider, providerUserId)) ?? null;
  }
  async getIdentity(identityId) {
    return [...this.identities.values()].find((identity) => identity.id === identityId) ?? null;
  }
  async createIdentity(identity) {
    const key = this.identityKey(identity.provider, identity.providerUserId);
    if (this.identities.has(key)) throw new Error('UNIQUE identity');
    this.identities.set(key, identity);
  }
  async countLoginIdentities(userId) {
    return [...this.identities.values()].filter((identity) => identity.userId === userId).length;
  }
  async removeIdentity(identityId) {
    const entry = [...this.identities.entries()].find(([, identity]) => identity.id === identityId);
    if (entry) this.identities.delete(entry[0]);
  }
}

export function addUser(repository, id, overrides = {}) {
  repository.users.set(id, { id, status: 'active', ...overrides });
  repository.profiles.set(id, {
    userId: id,
    displayName: null,
    phone: null,
    phoneVerified: false,
    email: null,
    emailVerified: false,
    defaultCommunityId: null,
  });
}

export function addCommunity(repository, id, overrides = {}) {
  repository.communities.set(id, {
    id,
    name: id,
    status: 'active',
    joinPolicy: 'open',
    ...overrides,
  });
}

export function addMembership(repository, userId, communityId, overrides = {}) {
  const membership = {
    id: `${userId}-${communityId}`,
    userId,
    communityId,
    role: 'resident',
    status: 'active',
    ...overrides,
  };
  repository.memberships.set(repository.membershipKey(userId, communityId), membership);
  return membership;
}
