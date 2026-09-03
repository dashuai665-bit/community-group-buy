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
export interface ProductRow { id: string; name: string; description: string | null; source_type: string; source_reference: string | null; unit_label: string; image_url: string | null; status: string }
export interface OfferingRow { id: string; community_id: string; product_id: string; status: string; price_minor: number; currency: string; batch_threshold: number; min_quantity_per_order: number; max_quantity_per_order: number | null }
export interface BatchRow { id: string; offering_id: string; sequence_number: number; status: string; threshold_quantity: number; committed_quantity: number }
export interface WishRow { id: string; user_id: string; community_id: string; product_id: string | null; wish_text: string | null; status: string }

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

export class ProductRepository extends RepositoryBase {
  findById(id: string) { return this.statement('SELECT id,name,description,source_type,source_reference,unit_label,image_url,status FROM products WHERE id = ?', id).first<ProductRow>(); }
  insertStatement(input: { id: string; name: string; description?: string | null; sourceType: string; sourceReference?: string | null; unitLabel: string; imageUrl?: string | null }) {
    return this.statement("INSERT INTO products (id,name,description,source_type,source_reference,unit_label,image_url,status) VALUES (?,?,?,?,?,?,?,'active')", input.id, input.name, input.description ?? null, input.sourceType, input.sourceReference ?? null, input.unitLabel, input.imageUrl ?? null);
  }
}

export class CommunityOfferingRepository extends RepositoryBase {
  findById(id: string) { return this.statement('SELECT id,community_id,product_id,status,price_minor,currency,batch_threshold,min_quantity_per_order,max_quantity_per_order FROM community_product_offerings WHERE id = ?', id).first<OfferingRow>(); }
  insertStatement(input: { id: string; communityId: string; productId: string; priceMinor: number; batchThreshold: number; minQuantity: number; maxQuantity?: number | null }) {
    return this.statement("INSERT INTO community_product_offerings (id,community_id,product_id,status,price_minor,currency,batch_threshold,min_quantity_per_order,max_quantity_per_order) VALUES (?,?,?,'active',?,'TWD',?,?,?)", input.id, input.communityId, input.productId, input.priceMinor, input.batchThreshold, input.minQuantity, input.maxQuantity ?? null);
  }
  updateStatement(input: { id: string; priceMinor: number; batchThreshold: number; minQuantity: number; maxQuantity?: number | null; status: string }) {
    return this.statement('UPDATE community_product_offerings SET price_minor=?,batch_threshold=?,min_quantity_per_order=?,max_quantity_per_order=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', input.priceMinor, input.batchThreshold, input.minQuantity, input.maxQuantity ?? null, input.status, input.id);
  }
  async listPublic(communityId: string) {
    return (await this.statement(`SELECT o.id AS offering_id,o.product_id,o.status AS offering_status,o.price_minor,o.currency,o.batch_threshold,o.min_quantity_per_order,o.max_quantity_per_order,
      p.name,p.description,p.image_url,p.unit_label,
      b.id AS batch_id,COALESCE(b.sequence_number,1) AS sequence_number,COALESCE(b.status,'open') AS batch_status,COALESCE(b.threshold_quantity,o.batch_threshold) AS threshold_quantity,COALESCE(b.committed_quantity,0) AS committed_quantity
      FROM community_product_offerings o JOIN products p ON p.id=o.product_id
      LEFT JOIN group_buy_batches b ON b.offering_id=o.id AND b.status='open'
      WHERE o.community_id=? AND o.status='active' AND p.status='active' ORDER BY p.name`, communityId).all()).results ?? [];
  }
  findPublicScoped(communityId: string, offeringId: string) {
    return this.statement(`SELECT o.id AS offering_id,o.product_id,o.status AS offering_status,o.price_minor,o.currency,o.batch_threshold,o.min_quantity_per_order,o.max_quantity_per_order,
      p.name,p.description,p.image_url,p.unit_label,
      b.id AS batch_id,COALESCE(b.sequence_number,1) AS sequence_number,COALESCE(b.status,'open') AS batch_status,COALESCE(b.threshold_quantity,o.batch_threshold) AS threshold_quantity,COALESCE(b.committed_quantity,0) AS committed_quantity
      FROM community_product_offerings o JOIN products p ON p.id=o.product_id
      LEFT JOIN group_buy_batches b ON b.offering_id=o.id AND b.status='open'
      WHERE o.id=? AND o.community_id=? AND o.status='active' AND p.status='active'`, offeringId, communityId).first<Record<string, unknown>>();
  }
}

export class GroupBuyBatchRepository extends RepositoryBase {
  async listForOffering(offeringId: string): Promise<BatchRow[]> {
    return (await this.statement('SELECT id,offering_id,sequence_number,status,threshold_quantity,committed_quantity FROM group_buy_batches WHERE offering_id=? ORDER BY sequence_number', offeringId).all<BatchRow>()).results ?? [];
  }
  findOpen(offeringId: string) { return this.statement("SELECT id,offering_id,sequence_number,status,threshold_quantity,committed_quantity FROM group_buy_batches WHERE offering_id=? AND status='open' ORDER BY sequence_number LIMIT 1", offeringId).first<BatchRow>(); }
  createOpenStatement(id: string, offeringId: string, sequence: number, threshold: number) {
    return this.statement("INSERT INTO group_buy_batches (id,offering_id,sequence_number,status,threshold_quantity) VALUES (?,?,?,'open',?)", id, offeringId, sequence, threshold);
  }
  allocationStatements(input: { requestId: string; offeringId: string; quantity: number; actorUserId: string }): SqlStatement[] {
    const { requestId, offeringId, quantity, actorUserId } = input;
    const ensureCapacity = this.statement(`WITH RECURSIVE params AS (
      SELECT o.batch_threshold AS threshold,
        COALESCE((SELECT SUM(threshold_quantity-committed_quantity) FROM group_buy_batches WHERE offering_id=o.id AND status='open'),0) AS capacity,
        COALESCE((SELECT MAX(sequence_number) FROM group_buy_batches WHERE offering_id=o.id),0) AS max_seq
      FROM community_product_offerings o WHERE o.id=? AND o.status='active'
    ), nums(n) AS (
      SELECT 1 FROM params WHERE ? > capacity AND NOT EXISTS (SELECT 1 FROM batch_commitments WHERE request_id=?)
      UNION ALL SELECT n+1 FROM nums,params WHERE n < CAST((? - capacity + threshold - 1) / threshold AS INTEGER)
    ) INSERT INTO group_buy_batches (id,offering_id,sequence_number,status,threshold_quantity)
      SELECT ? || '-batch-' || (max_seq+n), ?, max_seq+n, 'open', threshold FROM nums,params`, offeringId, quantity, requestId, quantity, requestId, offeringId);
    const insertLedger = this.statement(`WITH capacities AS (
      SELECT id,sequence_number,(threshold_quantity-committed_quantity) AS capacity,
        COALESCE(SUM(threshold_quantity-committed_quantity) OVER (ORDER BY sequence_number ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_capacity
      FROM group_buy_batches WHERE offering_id=? AND status='open'
    ) INSERT OR IGNORE INTO batch_commitments (id,request_id,batch_id,quantity,source_type)
      SELECT ? || '-commit-' || sequence_number, ?, id, MIN(capacity, MAX(0, ?-prior_capacity)), 'reservation'
      FROM capacities WHERE ? > prior_capacity AND capacity > 0`, offeringId, requestId, requestId, quantity, quantity);
    const refreshCache = this.statement(`UPDATE group_buy_batches SET committed_quantity=(SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id),updated_at=CURRENT_TIMESTAMP WHERE offering_id=? AND status='open'`, offeringId);
    const formFull = this.statement("UPDATE group_buy_batches SET status='formed',formed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE offering_id=? AND status='open' AND committed_quantity=threshold_quantity", offeringId);
    const auditFormed = this.statement(`INSERT OR IGNORE INTO audit_logs (id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
      SELECT ? || '-audit-' || b.id, ?, o.community_id, 'batch_formed', 'group_buy_batch', b.id,
        json_object('offeringId',o.id,'batchId',b.id,'quantity',b.committed_quantity,'threshold',b.threshold_quantity)
      FROM group_buy_batches b JOIN community_product_offerings o ON o.id=b.offering_id
      WHERE b.offering_id=? AND b.status='formed' AND EXISTS (SELECT 1 FROM batch_commitments c WHERE c.batch_id=b.id AND c.request_id=?)`, requestId, actorUserId, offeringId, requestId);
    return [ensureCapacity, insertLedger, refreshCache, formFull, auditFormed];
  }
}

export class ProductWishRepository extends RepositoryBase {
  insertStatement(input: { id: string; userId: string; communityId: string; productId?: string | null; wishText?: string | null }) {
    return this.statement("INSERT INTO product_wishes (id,user_id,community_id,product_id,wish_text,status) VALUES (?,?,?,?,?,'open')", input.id, input.userId, input.communityId, input.productId ?? null, input.wishText ?? null);
  }
  findById(id: string) { return this.statement('SELECT id,user_id,community_id,product_id,wish_text,status FROM product_wishes WHERE id=?', id).first<WishRow>(); }
  async listForUser(userId: string): Promise<WishRow[]> { return (await this.statement('SELECT id,user_id,community_id,product_id,wish_text,status FROM product_wishes WHERE user_id=? ORDER BY created_at DESC', userId).all<WishRow>()).results ?? []; }
  async listForCommunity(communityId: string): Promise<WishRow[]> { return (await this.statement('SELECT id,user_id,community_id,product_id,wish_text,status FROM product_wishes WHERE community_id=? ORDER BY created_at DESC', communityId).all<WishRow>()).results ?? []; }
  updateStatusStatement(id: string, status: string) { return this.statement('UPDATE product_wishes SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', status, id); }
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
  readonly products: ProductRepository;
  readonly offerings: CommunityOfferingRepository;
  readonly batches: GroupBuyBatchRepository;
  readonly wishes: ProductWishRepository;
  constructor(context: RepositoryContext) {
    this.context = context;
    this.users = new UserRepository(context);
    this.profiles = new UserProfileRepository(context);
    this.identities = new UserIdentityRepository(context);
    this.communities = new CommunityRepository(context);
    this.members = new CommunityMemberRepository(context);
    this.platformRoles = new PlatformRoleRepository(context);
    this.audits = new AuditLogRepository(context);
    this.products = new ProductRepository(context);
    this.offerings = new CommunityOfferingRepository(context);
    this.batches = new GroupBuyBatchRepository(context);
    this.wishes = new ProductWishRepository(context);
  }
  batch(statements: SqlStatement[]) { return this.context.db.batch(statements); }
}
