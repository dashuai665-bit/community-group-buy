import type { RepositoryContext, SqlStatement } from '../database.ts';

export interface UserRow { id: string; status: 'active' | 'suspended' | 'deleted' }
export interface ProfileRow {
  user_id: string; display_name: string | null; phone: string | null;
  phone_verified: 'true' | 'false'; email: string | null; email_verified: 'true' | 'false';
  default_community_id: string | null;
}
export interface IdentityRow {
  id: string; user_id: string; provider: string; provider_user_id: string;
  verified: 'true' | 'false'; metadata: string | null;
}
export interface CommunityRow {
  id: string; name: string; slug: string; status: 'active' | 'inactive';
  join_policy: 'open' | 'approval_required' | 'invite_only';
}
export interface MembershipRow {
  id: string; user_id: string; community_id: string; role: 'resident' | 'community_admin';
  status: 'active' | 'inactive';
}

class RepositoryBase {
  protected readonly context: RepositoryContext;
  constructor(context: RepositoryContext) { this.context = context; }
  protected statement(sql: string, ...values: unknown[]): SqlStatement {
    return this.context.db.prepare(sql).bind(...values);
  }
}

export class UserRepository extends RepositoryBase {
  findById(id: string) { return this.statement('SELECT id, status FROM users WHERE id = ?', id).first<UserRow>(); }
  insertStatement(id: string) {
    return this.statement("INSERT INTO users (id, status) VALUES (?, 'active')", id);
  }
}

export class UserProfileRepository extends RepositoryBase {
  findByUserId(userId: string) {
    return this.statement('SELECT user_id, display_name, phone, phone_verified, email, email_verified, default_community_id FROM user_profiles WHERE user_id = ?', userId).first<ProfileRow>();
  }
  insertStatement(userId: string, email: string | null) {
    return this.statement("INSERT INTO user_profiles (user_id, email, email_verified) VALUES (?, ?, 'false')", userId, email);
  }
  setDefaultStatement(userId: string, communityId: string | null) {
    return this.statement('UPDATE user_profiles SET default_community_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', communityId, userId);
  }
  reassignDefaultStatement(userId: string, leavingCommunityId: string) {
    return this.statement(`UPDATE user_profiles SET default_community_id = (
      SELECT cm.community_id FROM community_members cm JOIN communities c ON c.id = cm.community_id
      WHERE cm.user_id = ? AND cm.community_id <> ? AND cm.status = 'active' AND c.status = 'active'
      ORDER BY cm.joined_at, cm.community_id LIMIT 1
    ), updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND default_community_id = ?`, userId, leavingCommunityId, userId, leavingCommunityId);
  }
  changePhoneStatement(userId: string, phone: string) {
    return this.statement("UPDATE user_profiles SET phone = ?, phone_verified = CASE WHEN phone = ? THEN phone_verified ELSE 'false' END, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", phone, phone, userId);
  }
}

export class UserIdentityRepository extends RepositoryBase {
  find(provider: string, providerUserId: string) {
    return this.statement('SELECT id, user_id, provider, provider_user_id, verified, metadata FROM user_identities WHERE provider = ? AND provider_user_id = ?', provider, providerUserId).first<IdentityRow>();
  }
  findById(id: string) {
    return this.statement('SELECT id, user_id, provider, provider_user_id, verified, metadata FROM user_identities WHERE id = ?', id).first<IdentityRow>();
  }
  async countForUser(userId: string): Promise<number> {
    const row = await this.statement('SELECT count(*) AS count FROM user_identities WHERE user_id = ?', userId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
  insertStatement(id: string, userId: string, provider: string, providerUserId: string, verified: boolean, metadata: Record<string, unknown> | null = null) {
    return this.statement('INSERT INTO user_identities (id, user_id, provider, provider_user_id, verified, metadata) VALUES (?, ?, ?, ?, ?, ?)', id, userId, provider, providerUserId, verified ? 'true' : 'false', metadata ? JSON.stringify(metadata) : null);
  }
  deleteStatement(id: string) { return this.statement('DELETE FROM user_identities WHERE id = ?', id); }
}

export class CommunityRepository extends RepositoryBase {
  async listActive(): Promise<CommunityRow[]> {
    return (await this.statement("SELECT id, name, slug, status, join_policy FROM communities WHERE status = 'active' ORDER BY name").all<CommunityRow>()).results ?? [];
  }
  findById(id: string) { return this.statement('SELECT id, name, slug, status, join_policy FROM communities WHERE id = ?', id).first<CommunityRow>(); }
}

export class CommunityMemberRepository extends RepositoryBase {
  find(userId: string, communityId: string) {
    return this.statement('SELECT id, user_id, community_id, role, status FROM community_members WHERE user_id = ? AND community_id = ?', userId, communityId).first<MembershipRow>();
  }
  async listActiveForUser(userId: string) {
    return (await this.statement(`SELECT cm.id, cm.user_id, cm.community_id, cm.role, cm.status,
      c.name, c.slug, c.join_policy, c.status AS community_status
      FROM community_members cm JOIN communities c ON c.id = cm.community_id
      WHERE cm.user_id = ? AND cm.status = 'active' AND c.status = 'active' ORDER BY c.name`, userId).all()).results ?? [];
  }
  insertStatement(id: string, userId: string, communityId: string) {
    return this.statement("INSERT INTO community_members (id, user_id, community_id, role, status) VALUES (?, ?, ?, 'resident', 'active')", id, userId, communityId);
  }
  activateStatement(userId: string, communityId: string) {
    return this.statement("UPDATE community_members SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND community_id = ?", userId, communityId);
  }
  deactivateStatement(userId: string, communityId: string) {
    return this.statement("UPDATE community_members SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND community_id = ?", userId, communityId);
  }
  async countActiveAdmins(communityId: string): Promise<number> {
    const row = await this.statement("SELECT count(*) AS count FROM community_members WHERE community_id = ? AND role = 'community_admin' AND status = 'active'", communityId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
  findActiveTargetContact(userId: string, communityId: string) {
    return this.statement(`SELECT p.display_name, p.phone, p.phone_verified
      FROM community_members cm JOIN user_profiles p ON p.user_id = cm.user_id
      WHERE cm.user_id = ? AND cm.community_id = ? AND cm.status = 'active'`, userId, communityId).first<{ display_name: string | null; phone: string | null; phone_verified: 'true' | 'false' }>();
  }
}

export class PlatformRoleRepository extends RepositoryBase {
  async isPlatformAdmin(userId: string): Promise<boolean> {
    return Boolean(await this.statement("SELECT 1 AS found FROM platform_roles WHERE user_id = ? AND role = 'platform_admin'", userId).first());
  }
}

export class AuditLogRepository extends RepositoryBase {
  insertStatement(input: { id: string; actorUserId: string; communityId?: string | null; actionType: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }) {
    return this.statement('INSERT INTO audit_logs (id, actor_user_id, community_id, action_type, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)', input.id, input.actorUserId, input.communityId ?? null, input.actionType, input.targetType, input.targetId ?? null, input.metadata ? JSON.stringify(input.metadata) : null);
  }
  async list(): Promise<Record<string, unknown>[]> {
    return (await this.statement('SELECT * FROM audit_logs ORDER BY created_at, id').all()).results ?? [];
  }
}

export class Repositories {
  readonly context: RepositoryContext;
  readonly users: UserRepository;
  readonly profiles: UserProfileRepository;
  readonly identities: UserIdentityRepository;
  readonly communities: CommunityRepository;
  readonly members: CommunityMemberRepository;
  readonly platformRoles: PlatformRoleRepository;
  readonly audits: AuditLogRepository;
  constructor(context: RepositoryContext) {
    this.context = context;
    this.users = new UserRepository(context);
    this.profiles = new UserProfileRepository(context);
    this.identities = new UserIdentityRepository(context);
    this.communities = new CommunityRepository(context);
    this.members = new CommunityMemberRepository(context);
    this.platformRoles = new PlatformRoleRepository(context);
    this.audits = new AuditLogRepository(context);
  }
  batch(statements: SqlStatement[]) { return this.context.db.batch(statements); }
}
