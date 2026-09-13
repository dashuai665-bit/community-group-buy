import type { RepositoryContext, SqlStatement } from '../database.ts';

export interface UserRow {
  id: string;
  status: 'active' | 'suspended' | 'deleted';
}
export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  phone: string | null;
  phone_verified: 'true' | 'false';
  email: string | null;
  email_verified: 'true' | 'false';
  default_community_id: string | null;
}
export interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  verified: 'true' | 'false';
  metadata: string | null;
}
export interface CommunityRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  join_policy: 'open' | 'approval_required' | 'invite_only';
}
export interface MembershipRow {
  id: string;
  user_id: string;
  community_id: string;
  role: 'resident' | 'community_admin';
  status: 'active' | 'inactive';
}
export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_reference: string | null;
  unit_label: string;
  image_url: string | null;
  status: string;
}
export interface OfferingRow {
  id: string;
  community_id: string;
  product_id: string;
  status: string;
  price_minor: number;
  currency: string;
  batch_threshold: number;
  min_quantity_per_order: number;
  max_quantity_per_order: number | null;
}
export interface BatchRow {
  id: string;
  offering_id: string;
  sequence_number: number;
  status: string;
  threshold_quantity: number;
  committed_quantity: number;
}
export interface GroupingRow extends BatchRow {
  /** Shared condition identity; group_buy_batches.id is the unique instance ID. */
  grouping_condition_key: string;
  community_id: string;
  product_id: string;
  product_name: string;
  unit_label: string;
  currency: string;
  price_minor: number;
  formed_at: string | null;
  oldest_order_time: string | null;
  member_order_count: number;
  estimated_amount_minor: number;
}
export interface WishRow {
  id: string;
  user_id: string;
  community_id: string;
  community_name?: string;
  product_id: string | null;
  wish_text: string | null;
  status: string;
}
export interface OrderRow {
  id: string;
  user_id: string;
  community_id: string;
  status: string;
  currency: string;
  estimated_total_minor: number;
  actual_total_minor: number | null;
  idempotency_key: string;
  contact_name_snapshot: string;
  contact_phone_snapshot: string;
  cancel_reason: string | null;
  created_at: string;
}
export interface OrderItemRow {
  id: string;
  order_id: string;
  offering_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_label_snapshot: string;
  unit_price_minor: number;
  quantity: number;
  estimated_subtotal_minor: number;
}
export interface PickupRow {
  id: string;
  order_id: string;
  community_id: string;
  status: string;
  scheduled_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  pickup_location_snapshot: string | null;
  pickup_window_snapshot: string | null;
  handed_over_by_user_id: string | null;
}
export interface FulfillmentRow extends OrderRow {
  display_name: string | null;
  ordered_quantity: number;
  finalized_quantity: number;
  fulfilled_quantity: number;
  shortage_quantity: number;
  final_payable_minor: number;
  payment_status: 'paid' | null;
  payment_amount_minor: number | null;
  confirmed_at: string | null;
  pickup_status: string | null;
}
export interface PurchaseBatchRow {
  id: string;
  community_id: string;
  status: 'ready' | 'purchasing';
  idempotency_key: string;
  created_by_user_id: string;
  purchasing_started_by_user_id: string | null;
  purchasing_started_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface PurchaseFinalizationRow {
  purchase_batch_id: string;
  idempotency_key: string;
  canonical_payload: string;
  receipt_id: string | null;
  committed_quantity: number;
  purchased_quantity: number;
  shortage_quantity: number;
  estimated_total_minor: number;
  actual_total_minor: number;
  finalized_by_user_id: string;
  finalized_at: string;
}
export interface AuditListRow {
  id: string;
  actor_user_id: string;
  community_id: string | null;
  action_type: string;
  target_type: string;
  target_id: string | null;
  metadata: string | null;
  created_at: string;
  actor_display_name: string | null;
  community_name: string | null;
}

class RepositoryBase {
  protected readonly context: RepositoryContext;
  constructor(context: RepositoryContext) {
    this.context = context;
  }
  protected statement(sql: string, ...values: unknown[]): SqlStatement {
    return this.context.db.prepare(sql).bind(...values);
  }
}

export class UserRepository extends RepositoryBase {
  findById(id: string) {
    return this.statement(
      'SELECT id, status FROM users WHERE id = ?',
      id,
    ).first<UserRow>();
  }
  insertStatement(id: string) {
    return this.statement(
      "INSERT INTO users (id, status) VALUES (?, 'active')",
      id,
    );
  }
}

export class UserProfileRepository extends RepositoryBase {
  findByUserId(userId: string) {
    return this.statement(
      'SELECT user_id, display_name, phone, phone_verified, email, email_verified, default_community_id FROM user_profiles WHERE user_id = ?',
      userId,
    ).first<ProfileRow>();
  }
  insertStatement(userId: string, email: string | null, emailVerified = false) {
    return this.statement(
      'INSERT INTO user_profiles (user_id, email, email_verified) VALUES (?, ?, ?)',
      userId,
      email,
      emailVerified ? 'true' : 'false',
    );
  }
  setDefaultStatement(userId: string, communityId: string | null) {
    return this.statement(
      'UPDATE user_profiles SET default_community_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      communityId,
      userId,
    );
  }
  reassignDefaultStatement(userId: string, leavingCommunityId: string) {
    return this.statement(
      `UPDATE user_profiles SET default_community_id = (
      SELECT cm.community_id FROM community_members cm JOIN communities c ON c.id = cm.community_id
      WHERE cm.user_id = ? AND cm.community_id <> ? AND cm.status = 'active' AND c.status = 'active'
      ORDER BY cm.joined_at, cm.community_id LIMIT 1
    ), updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND default_community_id = ?`,
      userId,
      leavingCommunityId,
      userId,
      leavingCommunityId,
    );
  }
  changePhoneStatement(userId: string, phone: string) {
    return this.statement(
      "UPDATE user_profiles SET phone = ?, phone_verified = CASE WHEN phone = ? THEN phone_verified ELSE 'false' END, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
      phone,
      phone,
      userId,
    );
  }
  changeDisplayNameStatement(userId: string, displayName: string) {
    return this.statement(
      'UPDATE user_profiles SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      displayName,
      userId,
    );
  }
  completeOnboardingStatement(
    userId: string,
    displayName: string,
    phone: string,
  ) {
    return this.statement(
      "UPDATE user_profiles SET display_name = ?, phone = ?, phone_verified = 'false', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
      displayName,
      phone,
      userId,
    );
  }
}

export class UserIdentityRepository extends RepositoryBase {
  find(provider: string, providerUserId: string) {
    return this.statement(
      'SELECT id, user_id, provider, provider_user_id, verified, metadata FROM user_identities WHERE provider = ? AND provider_user_id = ?',
      provider,
      providerUserId,
    ).first<IdentityRow>();
  }
  findById(id: string) {
    return this.statement(
      'SELECT id, user_id, provider, provider_user_id, verified, metadata FROM user_identities WHERE id = ?',
      id,
    ).first<IdentityRow>();
  }
  async countForUser(userId: string): Promise<number> {
    const row = await this.statement(
      'SELECT count(*) AS count FROM user_identities WHERE user_id = ?',
      userId,
    ).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
  insertStatement(
    id: string,
    userId: string,
    provider: string,
    providerUserId: string,
    verified: boolean,
    metadata: Record<string, unknown> | null = null,
  ) {
    return this.statement(
      'INSERT INTO user_identities (id, user_id, provider, provider_user_id, verified, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      userId,
      provider,
      providerUserId,
      verified ? 'true' : 'false',
      metadata ? JSON.stringify(metadata) : null,
    );
  }
  deleteStatement(id: string) {
    return this.statement('DELETE FROM user_identities WHERE id = ?', id);
  }
}

export class CommunityRepository extends RepositoryBase {
  async listActive(): Promise<CommunityRow[]> {
    return (
      (
        await this.statement(
          "SELECT id, name, slug, status, join_policy FROM communities WHERE status = 'active' ORDER BY name",
        ).all<CommunityRow>()
      ).results ?? []
    );
  }
  async listAll(): Promise<CommunityRow[]> {
    return (
      (
        await this.statement(
          'SELECT id, name, slug, status, join_policy FROM communities ORDER BY name',
        ).all<CommunityRow>()
      ).results ?? []
    );
  }
  findById(id: string) {
    return this.statement(
      'SELECT id, name, slug, status, join_policy FROM communities WHERE id = ?',
      id,
    ).first<CommunityRow>();
  }
}

export class CommunityMemberRepository extends RepositoryBase {
  find(userId: string, communityId: string) {
    return this.statement(
      'SELECT id, user_id, community_id, role, status FROM community_members WHERE user_id = ? AND community_id = ?',
      userId,
      communityId,
    ).first<MembershipRow>();
  }
  async listActiveForUser(userId: string) {
    return (
      (
        await this.statement(
          `SELECT cm.id, cm.user_id, cm.community_id, cm.role, cm.status,
      c.name, c.slug, c.join_policy, c.status AS community_status
      FROM community_members cm JOIN communities c ON c.id = cm.community_id
      WHERE cm.user_id = ? AND cm.status = 'active' AND c.status = 'active' ORDER BY c.name`,
          userId,
        ).all()
      ).results ?? []
    );
  }
  insertStatement(id: string, userId: string, communityId: string) {
    return this.statement(
      "INSERT INTO community_members (id, user_id, community_id, role, status) VALUES (?, ?, ?, 'resident', 'active')",
      id,
      userId,
      communityId,
    );
  }
  activateStatement(userId: string, communityId: string) {
    return this.statement(
      "UPDATE community_members SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND community_id = ?",
      userId,
      communityId,
    );
  }
  deactivateStatement(userId: string, communityId: string) {
    return this.statement(
      "UPDATE community_members SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND community_id = ?",
      userId,
      communityId,
    );
  }
  async countActiveAdmins(communityId: string): Promise<number> {
    const row = await this.statement(
      "SELECT count(*) AS count FROM community_members WHERE community_id = ? AND role = 'community_admin' AND status = 'active'",
      communityId,
    ).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
  async listManagedForUser(userId: string) {
    return (
      (
        await this.statement(
          `SELECT cm.community_id,cm.role,c.name,c.slug,c.join_policy,c.status AS community_status
      FROM community_members cm JOIN communities c ON c.id=cm.community_id
      WHERE cm.user_id=? AND cm.status='active' AND cm.role='community_admin' ORDER BY c.name`,
          userId,
        ).all()
      ).results ?? []
    );
  }
  findActiveTargetContact(userId: string, communityId: string) {
    return this.statement(
      `SELECT p.display_name, p.phone, p.phone_verified
      FROM community_members cm JOIN user_profiles p ON p.user_id = cm.user_id
      WHERE cm.user_id = ? AND cm.community_id = ? AND cm.status = 'active'`,
      userId,
      communityId,
    ).first<{
      display_name: string | null;
      phone: string | null;
      phone_verified: 'true' | 'false';
    }>();
  }
}

export class PlatformRoleRepository extends RepositoryBase {
  async isPlatformAdmin(userId: string): Promise<boolean> {
    return Boolean(
      await this.statement(
        "SELECT 1 AS found FROM platform_roles WHERE user_id = ? AND role = 'platform_admin'",
        userId,
      ).first(),
    );
  }
}

export class AuditLogRepository extends RepositoryBase {
  insertStatement(input: {
    id: string;
    actorUserId: string;
    communityId?: string | null;
    actionType: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return this.statement(
      'INSERT INTO audit_logs (id, actor_user_id, community_id, action_type, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.id,
      input.actorUserId,
      input.communityId ?? null,
      input.actionType,
      input.targetType,
      input.targetId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );
  }
  async list(): Promise<Record<string, unknown>[]> {
    return (
      (
        await this.statement(
          'SELECT * FROM audit_logs ORDER BY created_at, id',
        ).all()
      ).results ?? []
    );
  }
  async listPage(input: {
    communityId?: string;
    event?: string;
    limit: number;
    offset: number;
  }) {
    const predicates: string[] = [];
    const values: unknown[] = [];
    if (input.communityId) {
      predicates.push('a.community_id = ?');
      values.push(input.communityId);
    }
    if (input.event) {
      predicates.push("(a.action_type = ? OR json_extract(a.metadata, '$.event') = ?)");
      values.push(input.event, input.event);
    }
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = (
      await this.statement(
        `SELECT a.id,a.actor_user_id,a.community_id,a.action_type,a.target_type,a.target_id,a.metadata,a.created_at,
          p.display_name actor_display_name,c.name community_name
         FROM audit_logs a
         LEFT JOIN user_profiles p ON p.user_id=a.actor_user_id
         LEFT JOIN communities c ON c.id=a.community_id
         ${where}
         ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,
        ...values,
        input.limit,
        input.offset,
      ).all<AuditListRow>()
    ).results ?? [];
    const count = await this.statement(
      `SELECT COUNT(*) total FROM audit_logs a ${where}`,
      ...values,
    ).first<{ total: number }>();
    return { rows, total: Number(count?.total ?? 0) };
  }
}

export class ProductRepository extends RepositoryBase {
  findById(id: string) {
    return this.statement(
      'SELECT id,name,description,source_type,source_reference,unit_label,image_url,status FROM products WHERE id = ?',
      id,
    ).first<ProductRow>();
  }
  insertStatement(input: {
    id: string;
    name: string;
    description?: string | null;
    sourceType: string;
    sourceReference?: string | null;
    unitLabel: string;
    imageUrl?: string | null;
  }) {
    return this.statement(
      "INSERT INTO products (id,name,description,source_type,source_reference,unit_label,image_url,status) VALUES (?,?,?,?,?,?,?,'active')",
      input.id,
      input.name,
      input.description ?? null,
      input.sourceType,
      input.sourceReference ?? null,
      input.unitLabel,
      input.imageUrl ?? null,
    );
  }
}

export class CommunityOfferingRepository extends RepositoryBase {
  findById(id: string) {
    return this.statement(
      'SELECT id,community_id,product_id,status,price_minor,currency,batch_threshold,min_quantity_per_order,max_quantity_per_order FROM community_product_offerings WHERE id = ?',
      id,
    ).first<OfferingRow>();
  }
  insertStatement(input: {
    id: string;
    communityId: string;
    productId: string;
    priceMinor: number;
    batchThreshold: number;
    minQuantity: number;
    maxQuantity?: number | null;
  }) {
    return this.statement(
      "INSERT INTO community_product_offerings (id,community_id,product_id,status,price_minor,currency,batch_threshold,min_quantity_per_order,max_quantity_per_order) VALUES (?,?,?,'active',?,'TWD',?,?,?)",
      input.id,
      input.communityId,
      input.productId,
      input.priceMinor,
      input.batchThreshold,
      input.minQuantity,
      input.maxQuantity ?? null,
    );
  }
  updateStatement(input: {
    id: string;
    priceMinor: number;
    batchThreshold: number;
    minQuantity: number;
    maxQuantity?: number | null;
    status: string;
  }) {
    return this.statement(
      'UPDATE community_product_offerings SET price_minor=?,batch_threshold=?,min_quantity_per_order=?,max_quantity_per_order=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      input.priceMinor,
      input.batchThreshold,
      input.minQuantity,
      input.maxQuantity ?? null,
      input.status,
      input.id,
    );
  }
  async listPublic(communityId: string) {
    return (
      (
        await this.statement(
          `SELECT o.id AS offering_id,o.product_id,o.status AS offering_status,o.price_minor,o.currency,o.batch_threshold,o.min_quantity_per_order,o.max_quantity_per_order,
      p.name,p.description,p.image_url,p.unit_label,
      b.id AS batch_id,COALESCE(b.sequence_number,1) AS sequence_number,COALESCE(b.status,'open') AS batch_status,COALESCE(b.threshold_quantity,o.batch_threshold) AS threshold_quantity,COALESCE(b.committed_quantity,0) AS committed_quantity
      FROM community_product_offerings o JOIN products p ON p.id=o.product_id
      LEFT JOIN group_buy_batches b ON b.offering_id=o.id AND b.status='open'
      WHERE o.community_id=? AND o.status='active' AND p.status='active' ORDER BY p.name`,
          communityId,
        ).all()
      ).results ?? []
    );
  }
  findPublicScoped(communityId: string, offeringId: string) {
    return this.statement(
      `SELECT o.id AS offering_id,o.product_id,o.status AS offering_status,o.price_minor,o.currency,o.batch_threshold,o.min_quantity_per_order,o.max_quantity_per_order,
      p.name,p.description,p.image_url,p.unit_label,
      b.id AS batch_id,COALESCE(b.sequence_number,1) AS sequence_number,COALESCE(b.status,'open') AS batch_status,COALESCE(b.threshold_quantity,o.batch_threshold) AS threshold_quantity,COALESCE(b.committed_quantity,0) AS committed_quantity
      FROM community_product_offerings o JOIN products p ON p.id=o.product_id
      LEFT JOIN group_buy_batches b ON b.offering_id=o.id AND b.status='open'
      WHERE o.id=? AND o.community_id=? AND o.status='active' AND p.status='active'`,
      offeringId,
      communityId,
    ).first<Record<string, unknown>>();
  }
  findOrderableDetails(communityId: string, offeringId: string) {
    return this.statement(
      `SELECT o.id,o.community_id,o.product_id,o.status,o.price_minor,o.currency,o.batch_threshold,o.min_quantity_per_order,o.max_quantity_per_order,
      p.name AS product_name,p.unit_label,p.status AS product_status
      FROM community_product_offerings o JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.community_id=?`,
      offeringId,
      communityId,
    ).first<Record<string, unknown>>();
  }
}

export class GroupBuyBatchRepository extends RepositoryBase {
  private groupingSelect(where: string, ...values: unknown[]) {
    return this.statement(
      `SELECT b.id,b.offering_id,o.community_id || ':' || o.id AS grouping_condition_key,b.sequence_number,b.status,b.threshold_quantity,b.committed_quantity,b.formed_at,
      o.community_id,o.product_id,o.currency,o.price_minor,p.name AS product_name,p.unit_label,
      MIN(CASE WHEN bc.status='active' THEN orders.created_at END) AS oldest_order_time,
      COUNT(DISTINCT CASE WHEN bc.status='active' THEN orders.id END) AS member_order_count,
      COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity*oi.unit_price_minor ELSE 0 END),0) AS estimated_amount_minor
      FROM group_buy_batches b
      JOIN community_product_offerings o ON o.id=b.offering_id
      JOIN products p ON p.id=o.product_id
      LEFT JOIN batch_commitments bc ON bc.batch_id=b.id
      LEFT JOIN order_items oi ON oi.id=bc.order_item_id
      LEFT JOIN orders ON orders.id=oi.order_id
      WHERE ${where}
      GROUP BY b.id,b.offering_id,b.sequence_number,b.status,b.threshold_quantity,b.committed_quantity,b.formed_at,o.community_id,o.product_id,o.currency,o.price_minor,p.name,p.unit_label`,
      ...values,
    );
  }
  async listForCommunity(communityId: string): Promise<GroupingRow[]> {
    return (
      (await this.groupingSelect('o.community_id=?', communityId).all<GroupingRow>())
        .results ?? []
    );
  }
  findGrouping(communityId: string, groupingId: string) {
    return this.groupingSelect(
      'o.community_id=? AND b.id=?',
      communityId,
      groupingId,
    ).first<GroupingRow>();
  }
  async listDemand(groupingId: string) {
    return (
      (
        await this.statement(
          `SELECT orders.id AS order_id,oi.id AS order_item_id,oi.product_name_snapshot,oi.unit_label_snapshot,
          bc.quantity,oi.unit_price_minor,orders.created_at AS order_created_at
          FROM batch_commitments bc JOIN order_items oi ON oi.id=bc.order_item_id
          JOIN orders ON orders.id=oi.order_id
          WHERE bc.batch_id=? AND bc.status='active' ORDER BY orders.created_at,orders.id,oi.id`,
          groupingId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  manualFormStatement(groupingId: string) {
    return this.statement(
      "UPDATE group_buy_batches SET status='formed',formed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='open' AND committed_quantity>0",
      groupingId,
    );
  }
  manualFormationAuditStatement(input: {
    groupingId: string;
    actorUserId: string;
    communityId: string;
    reason: string;
    quantity: number;
    threshold: number;
  }) {
    return this.statement(
      `INSERT INTO audit_logs (id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
      SELECT ?,?,?,'batch_formed','group_buy_batch',?,json_object('mode','manual','reason',?,'quantity',?,'threshold',?)
      WHERE changes()=1`,
      `manual-form-${input.groupingId}`,
      input.actorUserId,
      input.communityId,
      input.groupingId,
      input.reason,
      input.quantity,
      input.threshold,
    );
  }
  async listForOffering(offeringId: string): Promise<BatchRow[]> {
    return (
      (
        await this.statement(
          'SELECT id,offering_id,sequence_number,status,threshold_quantity,committed_quantity FROM group_buy_batches WHERE offering_id=? ORDER BY sequence_number',
          offeringId,
        ).all<BatchRow>()
      ).results ?? []
    );
  }
  findOpen(offeringId: string) {
    return this.statement(
      "SELECT id,offering_id,sequence_number,status,threshold_quantity,committed_quantity FROM group_buy_batches WHERE offering_id=? AND status='open' ORDER BY sequence_number LIMIT 1",
      offeringId,
    ).first<BatchRow>();
  }
  createOpenStatement(
    id: string,
    offeringId: string,
    sequence: number,
    threshold: number,
  ) {
    return this.statement(
      "INSERT INTO group_buy_batches (id,offering_id,sequence_number,status,threshold_quantity) VALUES (?,?,?,'open',?)",
      id,
      offeringId,
      sequence,
      threshold,
    );
  }
  allocationStatements(input: {
    requestId: string;
    offeringId: string;
    quantity: number;
    actorUserId: string;
    orderItemId?: string;
  }): SqlStatement[] {
    const { requestId, offeringId, quantity, actorUserId, orderItemId } = input;
    const ensureCapacity = this.statement(
      `WITH RECURSIVE params AS (
      SELECT o.batch_threshold AS threshold,
        COALESCE((SELECT SUM(threshold_quantity-committed_quantity) FROM group_buy_batches WHERE offering_id=o.id AND status='open'),0) AS capacity,
        COALESCE((SELECT MAX(sequence_number) FROM group_buy_batches WHERE offering_id=o.id),0) AS max_seq
      FROM community_product_offerings o WHERE o.id=? AND o.status='active'
    ), nums(n) AS (
      SELECT 1 FROM params WHERE ? > capacity AND NOT EXISTS (SELECT 1 FROM batch_commitments WHERE request_id=?)
      UNION ALL SELECT n+1 FROM nums,params WHERE n < CAST((? - capacity + threshold - 1) / threshold AS INTEGER)
    ) INSERT INTO group_buy_batches (id,offering_id,sequence_number,status,threshold_quantity)
      SELECT ? || '-batch-' || (max_seq+n), ?, max_seq+n, 'open', threshold FROM nums,params`,
      offeringId,
      quantity,
      requestId,
      quantity,
      requestId,
      offeringId,
    );
    const insertLedger = this.statement(
      `WITH capacities AS (
      SELECT id,sequence_number,(threshold_quantity-committed_quantity) AS capacity,
        COALESCE(SUM(threshold_quantity-committed_quantity) OVER (ORDER BY sequence_number ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_capacity
      FROM group_buy_batches WHERE offering_id=? AND status='open'
    ) INSERT OR IGNORE INTO batch_commitments (id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)
      SELECT ? || '-commit-' || sequence_number, ?, id, MIN(capacity, MAX(0, ?-prior_capacity)), ?, ?, ?, 'active'
      FROM capacities WHERE ? > prior_capacity AND capacity > 0`,
      offeringId,
      requestId,
      requestId,
      quantity,
      orderItemId ? 'order_item' : 'reservation',
      orderItemId ?? null,
      orderItemId ?? null,
      quantity,
    );
    const refreshCache = this.statement(
      `UPDATE group_buy_batches SET committed_quantity=(SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active'),updated_at=CURRENT_TIMESTAMP WHERE offering_id=? AND status='open'`,
      offeringId,
    );
    const formFull = this.statement(
      "UPDATE group_buy_batches SET status='formed',formed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE offering_id=? AND status='open' AND committed_quantity=threshold_quantity",
      offeringId,
    );
    const auditFormed = this.statement(
      `INSERT OR IGNORE INTO audit_logs (id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
      SELECT ? || '-audit-' || b.id, ?, o.community_id, 'batch_formed', 'group_buy_batch', b.id,
        json_object('offeringId',o.id,'batchId',b.id,'quantity',b.committed_quantity,'threshold',b.threshold_quantity)
      FROM group_buy_batches b JOIN community_product_offerings o ON o.id=b.offering_id
      WHERE b.offering_id=? AND b.status='formed' AND EXISTS (SELECT 1 FROM batch_commitments c WHERE c.batch_id=b.id AND c.request_id=?)`,
      requestId,
      actorUserId,
      offeringId,
      requestId,
    );
    return [ensureCapacity, insertLedger, refreshCache, formFull, auditFormed];
  }
}

const derivedOrderFormationStatusSql = `CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM order_items oi
    JOIN batch_commitments bc ON bc.order_item_id=oi.id AND bc.status='active'
    JOIN group_buy_batches b ON b.id=bc.batch_id
    WHERE oi.order_id=orders.id AND b.status IN ('formed','locked','closed')
  ) THEN 'submitted'
  WHEN EXISTS (
    SELECT 1 FROM order_items oi
    JOIN batch_commitments bc ON bc.order_item_id=oi.id AND bc.status='active'
    JOIN group_buy_batches b ON b.id=bc.batch_id
    WHERE oi.order_id=orders.id AND b.status NOT IN ('formed','locked','closed')
  ) THEN 'partially_formed'
  ELSE 'formed'
END`;

export class OrderRepository extends RepositoryBase {
  deriveStatusesForBatchStatement(batchId: string) {
    return this.statement(
      `UPDATE orders SET status=${derivedOrderFormationStatusSql},updated_at=CURRENT_TIMESTAMP
      WHERE changes()=1 AND status IN ('submitted','partially_formed','formed') AND id IN (SELECT DISTINCT oi.order_id FROM order_items oi JOIN batch_commitments bc ON bc.order_item_id=oi.id WHERE bc.batch_id=?)`,
      batchId,
    );
  }
  findById(id: string) {
    return this.statement(
      'SELECT * FROM orders WHERE id=?',
      id,
    ).first<OrderRow>();
  }
  findByUserIdempotency(userId: string, key: string) {
    return this.statement(
      'SELECT * FROM orders WHERE user_id=? AND idempotency_key=?',
      userId,
      key,
    ).first<OrderRow>();
  }
  async listForUser(userId: string): Promise<OrderRow[]> {
    return (
      (
        await this.statement(
          'SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC,id DESC',
          userId,
        ).all<OrderRow>()
      ).results ?? []
    );
  }
  async listForCommunity(communityId: string): Promise<OrderRow[]> {
    return (
      (
        await this.statement(
          'SELECT * FROM orders WHERE community_id=? ORDER BY created_at DESC,id DESC',
          communityId,
        ).all<OrderRow>()
      ).results ?? []
    );
  }
  async listItems(orderId: string): Promise<OrderItemRow[]> {
    return (
      (
        await this.statement(
          'SELECT * FROM order_items WHERE order_id=? ORDER BY created_at,id',
          orderId,
        ).all<OrderItemRow>()
      ).results ?? []
    );
  }
  insertStatement(input: {
    id: string;
    userId: string;
    communityId: string;
    total: number;
    currency: string;
    key: string;
    contactName: string;
    contactPhone: string;
  }) {
    return this.statement(
      "INSERT INTO orders(id,user_id,community_id,status,currency,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot) VALUES (?,?,?,'submitted',?,?,?,?,?)",
      input.id,
      input.userId,
      input.communityId,
      input.currency,
      input.total,
      input.key,
      input.contactName,
      input.contactPhone,
    );
  }
  insertItemStatement(input: {
    id: string;
    orderId: string;
    offeringId: string;
    productId: string;
    productName: string;
    unitLabel: string;
    unitPrice: number;
    quantity: number;
  }) {
    return this.statement(
      'INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor) VALUES (?,?,?,?,?,?,?,?,?)',
      input.id,
      input.orderId,
      input.offeringId,
      input.productId,
      input.productName,
      input.unitLabel,
      input.unitPrice,
      input.quantity,
      input.unitPrice * input.quantity,
    );
  }
  deriveStatusStatement(orderId: string) {
    return this.statement(
      `UPDATE orders SET status=${derivedOrderFormationStatusSql},updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('cancelled','ready_for_pickup','completed')`,
      orderId,
    );
  }
  cancelCommitmentsStatement(orderId: string) {
    return this.statement(
      "UPDATE batch_commitments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP WHERE status='active' AND order_item_id IN (SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.order_id=? AND o.status='cancelled')",
      orderId,
    );
  }
  recalculateBatchesStatement(orderId: string) {
    return this.statement(
      `UPDATE group_buy_batches SET committed_quantity=(SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active'),status=CASE WHEN status='formed' AND (SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active') < threshold_quantity THEN 'open' ELSE status END,formed_at=CASE WHEN status='formed' AND (SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active') < threshold_quantity THEN NULL ELSE formed_at END,updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT bc.batch_id FROM batch_commitments bc JOIN order_items oi ON oi.id=bc.order_item_id WHERE oi.order_id=?) AND status IN ('open','formed')`,
      orderId,
    );
  }
  deriveAffectedStatusesStatement(orderId: string) {
    return this.statement(
      `UPDATE orders SET status=${derivedOrderFormationStatusSql},updated_at=CURRENT_TIMESTAMP
    WHERE status IN ('submitted','partially_formed','formed') AND id IN (SELECT DISTINCT oi2.order_id FROM order_items oi2 JOIN batch_commitments bc2 ON bc2.order_item_id=oi2.id WHERE bc2.batch_id IN (SELECT bc3.batch_id FROM batch_commitments bc3 JOIN order_items oi3 ON oi3.id=bc3.order_item_id WHERE oi3.order_id=?))`,
      orderId,
    );
  }
  cancelStatement(
    orderId: string,
    actorId: string,
    reason: string,
    admin: boolean,
  ) {
    return this.statement(
      `UPDATE orders SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN (${admin ? "'submitted','partially_formed','formed'" : "'submitted','partially_formed'"})`,
      actorId,
      reason,
      orderId,
    );
  }
  hasLockedCommitments(orderId: string) {
    return this.statement(
      "SELECT 1 AS found FROM order_items oi JOIN batch_commitments bc ON bc.order_item_id=oi.id AND bc.status='active' JOIN group_buy_batches b ON b.id=bc.batch_id WHERE oi.order_id=? AND b.status IN ('locked','closed') LIMIT 1",
      orderId,
    ).first();
  }
  async hasUnfinishedForCommunity(
    userId: string,
    communityId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.statement(
        "SELECT 1 FROM orders o LEFT JOIN pickup_records p ON p.order_id=o.id WHERE o.user_id=? AND o.community_id=? AND (o.status IN ('submitted','partially_formed','formed','ready_for_pickup') OR p.status IN ('pending','ready')) LIMIT 1",
        userId,
        communityId,
      ).first(),
    );
  }
}

export class PickupRepository extends RepositoryBase {
  findByOrderId(orderId: string) {
    return this.statement(
      'SELECT * FROM pickup_records WHERE order_id=?',
      orderId,
    ).first<PickupRow>();
  }
  createStatement(id: string, orderId: string, communityId: string) {
    return this.statement(
      "INSERT INTO pickup_records(id,order_id,community_id,status) VALUES (?,?,?,'pending')",
      id,
      orderId,
      communityId,
    );
  }
  private fulfillmentQuery(where: string, value: string) {
    return this.statement(
      `SELECT o.*,up.display_name,
       COALESCE(SUM(oi.quantity),0) AS ordered_quantity,
       COALESCE(SUM(x.finalized_quantity),0) AS finalized_quantity,
       COALESCE(SUM(x.fulfilled_quantity),0) AS fulfilled_quantity,
       COALESCE(SUM(x.shortage_quantity),0) AS shortage_quantity,
       COALESCE(SUM(x.final_payable_minor),0) AS final_payable_minor,
       cp.status AS payment_status,cp.amount_minor AS payment_amount_minor,cp.confirmed_at,
       pr.status AS pickup_status
       FROM orders o JOIN user_profiles up ON up.user_id=o.user_id
       JOIN order_items oi ON oi.order_id=o.id
       LEFT JOIN (
         SELECT order_item_id,SUM(committed_quantity_snapshot) AS finalized_quantity,
          SUM(fulfilled_quantity) AS fulfilled_quantity,SUM(shortage_quantity) AS shortage_quantity,
          SUM(final_amount_minor) AS final_payable_minor
         FROM purchase_allocations GROUP BY order_item_id
       ) x ON x.order_item_id=oi.id
       LEFT JOIN cash_payments cp ON cp.order_id=o.id
       LEFT JOIN pickup_records pr ON pr.order_id=o.id
       WHERE ${where} AND o.status<>'cancelled'
       GROUP BY o.id,up.user_id,cp.order_id,pr.order_id`,
      value,
    );
  }
  findFulfillment(orderId: string) {
    return this.fulfillmentQuery('o.id=?', orderId).first<FulfillmentRow>();
  }
  async listFulfillments(communityId: string) {
    return (
      (await this.fulfillmentQuery('o.community_id=?', communityId).all<FulfillmentRow>()).results ?? []
    );
  }
  async listFulfillmentItems(orderId: string) {
    return (
      (
        await this.statement(
          `SELECT oi.id,oi.product_name_snapshot,oi.unit_label_snapshot,oi.quantity AS ordered_quantity,
           COALESCE(SUM(pa.committed_quantity_snapshot),0) AS finalized_quantity,
           COALESCE(SUM(pa.fulfilled_quantity),0) AS fulfilled_quantity,
           COALESCE(SUM(pa.shortage_quantity),0) AS shortage_quantity,
           COALESCE(SUM(pa.final_amount_minor),0) AS final_payable_minor
           FROM order_items oi LEFT JOIN purchase_allocations pa ON pa.order_item_id=oi.id
           WHERE oi.order_id=? GROUP BY oi.id ORDER BY oi.created_at,oi.id`,
          orderId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  paymentStatement(orderId: string, communityId: string, amountMinor: number, actorUserId: string) {
    return this.statement(
      "INSERT OR IGNORE INTO cash_payments(order_id,community_id,amount_minor,method,status,confirmed_by_user_id) VALUES(?,? ,?,'cash','paid',?)",
      orderId, communityId, amountMinor, actorUserId,
    );
  }
  paymentAuditStatement(id: string, actorUserId: string, communityId: string, orderId: string, amountMinor: number) {
    return this.statement(
      `INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
       SELECT ?,?,?,'pickup_ready','order',?,? WHERE changes()=1`,
      id, actorUserId, communityId, orderId,
      JSON.stringify({ event: 'CASH_PAYMENT_CONFIRMED', orderId, communityId, actor: actorUserId, amountMinor, previousState: 'unpaid', newState: 'paid' }),
    );
  }
  prepareStatement(id: string, orderId: string, communityId: string, location: string, window: string) {
    return this.statement(
      "INSERT OR IGNORE INTO pickup_records(id,order_id,community_id,status,ready_at,pickup_location_snapshot,pickup_window_snapshot) VALUES(?,?,?,'ready',CURRENT_TIMESTAMP,?,?)",
      id, orderId, communityId, location, window,
    );
  }
  handoverStatement(orderId: string, actorUserId: string) {
    return this.statement(
      "UPDATE pickup_records SET status='picked_up',picked_up_at=CURRENT_TIMESTAMP,handed_over_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='ready' AND EXISTS(SELECT 1 FROM cash_payments WHERE order_id=? AND status='paid')",
      actorUserId, orderId, orderId,
    );
  }
  handoverAuditStatement(id: string, actorUserId: string, communityId: string, orderId: string) {
    return this.statement(
      `INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
       SELECT ?,?,?,'pickup_completed','order',?,? WHERE changes()=1`,
      id, actorUserId, communityId, orderId,
      JSON.stringify({ event: 'ORDER_HANDED_OVER', orderId, communityId, actor: actorUserId, previousState: 'pending', newState: 'handed_over' }),
    );
  }
  fulfillmentOrderReadyStatement(orderId: string) {
    return this.statement(
      "UPDATE orders SET status='ready_for_pickup',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='formed'",
      orderId,
    );
  }
  fulfillmentOrderCompleteStatement(orderId: string) {
    return this.statement(
      "UPDATE orders SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ready_for_pickup' AND EXISTS(SELECT 1 FROM cash_payments WHERE order_id=? AND status='paid') AND EXISTS(SELECT 1 FROM pickup_records WHERE order_id=? AND status='picked_up')",
      orderId, orderId, orderId,
    );
  }
  readyStatement(orderId: string) {
    return this.statement(
      "UPDATE pickup_records SET status='ready',ready_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='pending'",
      orderId,
    );
  }
  completeStatement(orderId: string) {
    return this.statement(
      "UPDATE pickup_records SET status='picked_up',picked_up_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='ready'",
      orderId,
    );
  }
  orderReadyStatement(orderId: string) {
    return this.statement(
      "UPDATE orders SET status='ready_for_pickup',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='formed'",
      orderId,
    );
  }
  orderCompleteStatement(orderId: string) {
    return this.statement(
      "UPDATE orders SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ready_for_pickup'",
      orderId,
    );
  }
  lockBatchesStatement(orderId: string) {
    return this.statement(
      "UPDATE group_buy_batches SET status='locked',updated_at=CURRENT_TIMESTAMP WHERE status='formed' AND id IN (SELECT bc.batch_id FROM batch_commitments bc JOIN order_items oi ON oi.id=bc.order_item_id WHERE oi.order_id=? AND bc.status='active')",
      orderId,
    );
  }
}

export class ReconciliationRepository extends RepositoryBase {
  async inspect(orderId: string) {
    const itemDrift =
      (
        await this.statement(
          "SELECT oi.id,CASE WHEN o.status='cancelled' THEN 0 ELSE oi.quantity END AS expected,COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity ELSE 0 END),0) AS committed FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN batch_commitments bc ON bc.order_item_id=oi.id WHERE oi.order_id=? GROUP BY oi.id HAVING expected<>committed",
          orderId,
        ).all()
      ).results ?? [];
    const batchDrift =
      (
        await this.statement(
          "SELECT b.id,b.committed_quantity,COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity ELSE 0 END),0) AS actual FROM group_buy_batches b LEFT JOIN batch_commitments bc ON bc.batch_id=b.id WHERE b.id IN (SELECT bc2.batch_id FROM batch_commitments bc2 JOIN order_items oi ON oi.id=bc2.order_item_id WHERE oi.order_id=?) GROUP BY b.id HAVING b.committed_quantity<>actual",
          orderId,
        ).all()
      ).results ?? [];
    const totalDrift =
      (
        await this.statement(
          'SELECT o.id,o.estimated_total_minor,COALESCE(SUM(oi.estimated_subtotal_minor),0) AS actual FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.id=? GROUP BY o.id HAVING o.estimated_total_minor<>actual',
          orderId,
        ).all()
      ).results ?? [];
    return {
      ok:
        itemDrift.length === 0 &&
        batchDrift.length === 0 &&
        totalDrift.length === 0,
      itemDrift,
      batchDrift,
      totalDrift,
    };
  }
  async inspectProcurement(purchaseBatchId: string) {
    const groupingDrift =
      (
        await this.statement(
          `SELECT r.group_buy_batch_id,r.purchased_quantity,r.shortage_quantity,
           COALESCE(SUM(a.fulfilled_quantity),0) AS allocated,
           COALESCE(SUM(a.shortage_quantity),0) AS allocated_shortage
           FROM purchase_group_results r LEFT JOIN purchase_allocations a ON a.group_buy_batch_id=r.group_buy_batch_id
           WHERE r.purchase_batch_id=? GROUP BY r.group_buy_batch_id
           HAVING r.purchased_quantity<>allocated OR r.shortage_quantity<>allocated_shortage`,
          purchaseBatchId,
        ).all()
      ).results ?? [];
    const allocationDrift =
      (
        await this.statement(
          `SELECT batch_commitment_id FROM purchase_allocations
           WHERE purchase_batch_id=? AND fulfilled_quantity+shortage_quantity<>committed_quantity_snapshot`,
          purchaseBatchId,
        ).all()
      ).results ?? [];
    const totalDrift =
      (
        await this.statement(
          `SELECT f.purchase_batch_id,f.actual_total_minor,COALESCE(SUM(r.actual_subtotal_minor),0) AS calculated
           FROM purchase_batch_finalizations f LEFT JOIN purchase_group_results r ON r.purchase_batch_id=f.purchase_batch_id
           WHERE f.purchase_batch_id=? GROUP BY f.purchase_batch_id HAVING f.actual_total_minor<>calculated`,
          purchaseBatchId,
        ).all()
      ).results ?? [];
    const payableDrift =
      (
        await this.statement(
          `SELECT a.group_buy_batch_id FROM purchase_allocations a
           JOIN purchase_group_results r ON r.group_buy_batch_id=a.group_buy_batch_id
           WHERE a.purchase_batch_id=? AND a.final_amount_minor<>a.fulfilled_quantity*r.actual_unit_price_minor`,
          purchaseBatchId,
        ).all()
      ).results ?? [];
    const relationalDrift =
      (
        await this.statement(
          `SELECT a.batch_commitment_id FROM purchase_allocations a
           LEFT JOIN purchase_group_results r ON r.group_buy_batch_id=a.group_buy_batch_id
             AND r.purchase_batch_id=a.purchase_batch_id
           LEFT JOIN batch_commitments bc ON bc.id=a.batch_commitment_id
             AND bc.batch_id=a.group_buy_batch_id AND bc.order_item_id=a.order_item_id
             AND bc.status='active'
           WHERE a.purchase_batch_id=? AND (r.group_buy_batch_id IS NULL OR bc.id IS NULL)`,
          purchaseBatchId,
        ).all()
      ).results ?? [];
    return {
      ok:
        groupingDrift.length === 0 &&
        allocationDrift.length === 0 &&
        totalDrift.length === 0 &&
        payableDrift.length === 0 &&
        relationalDrift.length === 0,
      groupingDrift,
      allocationDrift,
      totalDrift,
      payableDrift,
      relationalDrift,
    };
  }
  async inspectFulfillment(orderId: string) {
    const paymentDrift =
      (
        await this.statement(
          `SELECT cp.order_id FROM cash_payments cp
           WHERE cp.order_id=? AND cp.amount_minor<>(SELECT COALESCE(SUM(final_amount_minor),0) FROM purchase_allocations pa JOIN order_items oi ON oi.id=pa.order_item_id WHERE oi.order_id=cp.order_id)`,
          orderId,
        ).all()
      ).results ?? [];
    const handoverDrift =
      (
        await this.statement(
          `SELECT pr.order_id FROM pickup_records pr LEFT JOIN cash_payments cp ON cp.order_id=pr.order_id
           WHERE pr.order_id=? AND pr.status='picked_up' AND (pr.handed_over_by_user_id IS NULL OR pr.picked_up_at IS NULL OR cp.status<>'paid' OR cp.status IS NULL)`,
          orderId,
        ).all()
      ).results ?? [];
    const zeroFulfillmentDrift =
      (
        await this.statement(
          `SELECT o.id FROM orders o JOIN cash_payments cp ON cp.order_id=o.id
           WHERE o.id=? AND (SELECT COALESCE(SUM(pa.fulfilled_quantity),0) FROM purchase_allocations pa JOIN order_items oi ON oi.id=pa.order_item_id WHERE oi.order_id=o.id)=0`,
          orderId,
        ).all()
      ).results ?? [];
    const completionDrift =
      (
        await this.statement(
          `SELECT o.id FROM orders o LEFT JOIN cash_payments cp ON cp.order_id=o.id LEFT JOIN pickup_records pr ON pr.order_id=o.id
           WHERE o.id=? AND o.status='completed' AND (cp.status<>'paid' OR cp.status IS NULL OR pr.status<>'picked_up' OR pr.status IS NULL)`,
          orderId,
        ).all()
      ).results ?? [];
    return {
      ok: paymentDrift.length === 0 && handoverDrift.length === 0 && zeroFulfillmentDrift.length === 0 && completionDrift.length === 0,
      paymentDrift,
      handoverDrift,
      zeroFulfillmentDrift,
      completionDrift,
    };
  }
}

export class ProductWishRepository extends RepositoryBase {
  insertStatement(input: {
    id: string;
    userId: string;
    communityId: string;
    productId?: string | null;
    wishText?: string | null;
  }) {
    return this.statement(
      "INSERT INTO product_wishes (id,user_id,community_id,product_id,wish_text,status) VALUES (?,?,?,?,?,'open')",
      input.id,
      input.userId,
      input.communityId,
      input.productId ?? null,
      input.wishText ?? null,
    );
  }
  findById(id: string) {
    return this.statement(
      'SELECT id,user_id,community_id,product_id,wish_text,status FROM product_wishes WHERE id=?',
      id,
    ).first<WishRow>();
  }
  async listForUser(userId: string): Promise<WishRow[]> {
    return (
      (
        await this.statement(
          'SELECT w.id,w.user_id,w.community_id,c.name AS community_name,w.product_id,w.wish_text,w.status FROM product_wishes w JOIN communities c ON c.id=w.community_id WHERE w.user_id=? ORDER BY w.created_at DESC',
          userId,
        ).all<WishRow>()
      ).results ?? []
    );
  }
  async listForCommunity(communityId: string): Promise<WishRow[]> {
    return (
      (
        await this.statement(
          'SELECT id,user_id,community_id,product_id,wish_text,status FROM product_wishes WHERE community_id=? ORDER BY created_at DESC',
          communityId,
        ).all<WishRow>()
      ).results ?? []
    );
  }
  updateStatusStatement(id: string, status: string) {
    return this.statement(
      'UPDATE product_wishes SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      status,
      id,
    );
  }
}

export interface OperationsSummaryRow {
  collecting: number;
  grouped_ready: number;
  pending_purchase: number;
  pending_pickup: number;
  unfinished_orders: number;
}
export class PurchaseBatchRepository extends RepositoryBase {
  findById(communityId: string, id: string) {
    return this.statement(
      `SELECT p.*,creator.display_name AS created_by_name,starter.display_name AS purchasing_started_by_name
       FROM purchase_batches p
       LEFT JOIN user_profiles creator ON creator.user_id=p.created_by_user_id
       LEFT JOIN user_profiles starter ON starter.user_id=p.purchasing_started_by_user_id
       WHERE p.community_id=? AND p.id=?`,
      communityId,
      id,
    ).first<PurchaseBatchRow & Record<string, unknown>>();
  }
  findByIdempotency(communityId: string, key: string) {
    return this.statement(
      'SELECT * FROM purchase_batches WHERE community_id=? AND idempotency_key=?',
      communityId,
      key,
    ).first<PurchaseBatchRow>();
  }
  async listForCommunity(communityId: string) {
    return (
      (
        await this.statement(
          `SELECT p.*,CASE WHEN f.purchase_batch_id IS NULL THEN p.status ELSE 'finalized' END AS display_status,
           f.purchased_quantity,f.shortage_quantity,f.actual_total_minor,f.finalized_at,
           COUNT(pg.group_buy_batch_id) AS group_count,
           COALESCE(SUM(g.committed_quantity),0) AS total_quantity,
           COALESCE(SUM((SELECT SUM(bc.quantity*oi.unit_price_minor) FROM batch_commitments bc JOIN order_items oi ON oi.id=bc.order_item_id WHERE bc.batch_id=g.id AND bc.status='active')),0) AS estimated_total_minor
           FROM purchase_batches p
           LEFT JOIN purchase_batch_groups pg ON pg.purchase_batch_id=p.id
           LEFT JOIN group_buy_batches g ON g.id=pg.group_buy_batch_id
           LEFT JOIN purchase_batch_finalizations f ON f.purchase_batch_id=p.id
           WHERE p.community_id=? GROUP BY p.id ORDER BY p.created_at DESC,p.id DESC`,
          communityId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  async listGroups(purchaseBatchId: string) {
    return (
      (
        await this.statement(
          `SELECT g.id,g.sequence_number,g.status,g.threshold_quantity,g.committed_quantity,g.formed_at,
           o.id AS offering_id,o.currency,p.name AS product_name,p.unit_label,
           COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity*oi.unit_price_minor ELSE 0 END),0) AS estimated_amount_minor,
           r.purchased_quantity,r.shortage_quantity,r.actual_unit_price_minor,r.actual_subtotal_minor
           FROM purchase_batch_groups pg JOIN group_buy_batches g ON g.id=pg.group_buy_batch_id
           JOIN community_product_offerings o ON o.id=g.offering_id JOIN products p ON p.id=o.product_id
           LEFT JOIN batch_commitments bc ON bc.batch_id=g.id LEFT JOIN order_items oi ON oi.id=bc.order_item_id
           LEFT JOIN purchase_group_results r ON r.group_buy_batch_id=g.id
           WHERE pg.purchase_batch_id=? GROUP BY g.id,o.id,o.currency,p.name,p.unit_label,r.group_buy_batch_id ORDER BY pg.created_at,g.id`,
          purchaseBatchId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  async listEligibleGroups(communityId: string) {
    return (
      (
        await this.statement(
          `SELECT g.id,g.sequence_number,g.status,g.threshold_quantity,g.committed_quantity,g.formed_at,
           o.id AS offering_id,o.currency,p.name AS product_name,p.unit_label,
           COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity*oi.unit_price_minor ELSE 0 END),0) AS estimated_amount_minor
           FROM group_buy_batches g JOIN community_product_offerings o ON o.id=g.offering_id JOIN products p ON p.id=o.product_id
           LEFT JOIN batch_commitments bc ON bc.batch_id=g.id LEFT JOIN order_items oi ON oi.id=bc.order_item_id
           WHERE o.community_id=? AND g.status='formed' AND NOT EXISTS (SELECT 1 FROM purchase_batch_groups pg WHERE pg.group_buy_batch_id=g.id)
           GROUP BY g.id,o.id,o.currency,p.name,p.unit_label ORDER BY g.formed_at,g.id`,
          communityId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  async findGroupings(communityId: string, ids: string[]) {
    if (!ids.length) return [];
    return (
      (
        await this.statement(
          `SELECT g.id,g.status,o.community_id FROM group_buy_batches g JOIN community_product_offerings o ON o.id=g.offering_id WHERE o.community_id=? AND g.id IN (${ids.map(() => '?').join(',')})`,
          communityId,
          ...ids,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  async assignedGroupingIds(ids: string[]) {
    if (!ids.length) return [];
    return (
      (
        await this.statement(
          `SELECT group_buy_batch_id FROM purchase_batch_groups WHERE group_buy_batch_id IN (${ids.map(() => '?').join(',')})`,
          ...ids,
        ).all<{ group_buy_batch_id: string }>()
      ).results ?? []
    ).map((row) => row.group_buy_batch_id);
  }
  insertStatement(input: {
    id: string;
    communityId: string;
    idempotencyKey: string;
    actorUserId: string;
  }) {
    return this.statement(
      "INSERT INTO purchase_batches(id,community_id,status,idempotency_key,created_by_user_id) VALUES (?,?, 'ready',?,?)",
      input.id,
      input.communityId,
      input.idempotencyKey,
      input.actorUserId,
    );
  }
  insertGroupStatement(purchaseBatchId: string, groupingId: string) {
    return this.statement(
      'INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id) VALUES (?,?)',
      purchaseBatchId,
      groupingId,
    );
  }
  startStatement(id: string, actorUserId: string) {
    return this.statement(
      "UPDATE purchase_batches SET status='purchasing',purchasing_started_by_user_id=?,purchasing_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ready'",
      actorUserId,
      id,
    );
  }
  startAuditStatement(input: {
    id: string;
    purchaseBatchId: string;
    communityId: string;
    actorUserId: string;
  }) {
    return this.statement(
      `INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
       SELECT ?,?,?,'order_status_changed','purchase_batch',?,json_object('event','PURCHASE_BATCH_STARTED','previousStatus','ready','newStatus','purchasing') WHERE changes()=1`,
      input.id,
      input.actorUserId,
      input.communityId,
      input.purchaseBatchId,
    );
  }
  findFinalization(purchaseBatchId: string) {
    return this.statement(
      'SELECT * FROM purchase_batch_finalizations WHERE purchase_batch_id=?',
      purchaseBatchId,
    ).first<PurchaseFinalizationRow>();
  }
  async listCommitments(groupingId: string) {
    return (
      (
        await this.statement(
          `SELECT bc.id,bc.order_item_id,bc.quantity,o.created_at AS order_created_at,o.id AS order_id
           FROM batch_commitments bc
           JOIN order_items oi ON oi.id=bc.order_item_id
           JOIN orders o ON o.id=oi.order_id
           WHERE bc.batch_id=? AND bc.status='active'
           ORDER BY o.created_at,o.id,oi.id,bc.id`,
          groupingId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
  findReceipt(communityId: string, purchaseBatchId: string, receiptId: string) {
    return this.statement(
      `SELECT r.* FROM purchase_receipts r JOIN purchase_batches p ON p.id=r.purchase_batch_id
       WHERE p.community_id=? AND r.purchase_batch_id=? AND r.id=?`,
      communityId,
      purchaseBatchId,
      receiptId,
    ).first<Record<string, unknown>>();
  }
  insertReceiptStatement(input: {
    id: string;
    purchaseBatchId: string;
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    actorUserId: string;
  }) {
    return this.statement(
      'INSERT INTO purchase_receipts(id,purchase_batch_id,storage_key,original_filename,mime_type,size_bytes,uploaded_by_user_id) VALUES (?,?,?,?,?,?,?)',
      input.id,
      input.purchaseBatchId,
      input.storageKey,
      input.originalFilename,
      input.mimeType,
      input.sizeBytes,
      input.actorUserId,
    );
  }
  insertFinalizationStatement(input: {
    purchaseBatchId: string;
    idempotencyKey: string;
    canonicalPayload: string;
    receiptId: string | null;
    committedQuantity: number;
    purchasedQuantity: number;
    shortageQuantity: number;
    estimatedTotalMinor: number;
    actualTotalMinor: number;
    actorUserId: string;
  }) {
    return this.statement(
      `INSERT INTO purchase_batch_finalizations(purchase_batch_id,idempotency_key,canonical_payload,receipt_id,committed_quantity,purchased_quantity,shortage_quantity,estimated_total_minor,actual_total_minor,finalized_by_user_id)
       SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM purchase_batches WHERE id=? AND status='purchasing')`,
      input.purchaseBatchId,
      input.idempotencyKey,
      input.canonicalPayload,
      input.receiptId,
      input.committedQuantity,
      input.purchasedQuantity,
      input.shortageQuantity,
      input.estimatedTotalMinor,
      input.actualTotalMinor,
      input.actorUserId,
      input.purchaseBatchId,
    );
  }
  insertGroupResultStatement(input: {
    purchaseBatchId: string;
    groupingId: string;
    committedQuantity: number;
    purchasedQuantity: number;
    actualUnitPriceMinor: number;
    estimatedSubtotalMinor: number;
  }) {
    return this.statement(
      `INSERT INTO purchase_group_results(group_buy_batch_id,purchase_batch_id,committed_quantity_snapshot,purchased_quantity,shortage_quantity,actual_unit_price_minor,estimated_subtotal_minor,actual_subtotal_minor)
       VALUES (?,?,?,?,?,?,?,?)`,
      input.groupingId,
      input.purchaseBatchId,
      input.committedQuantity,
      input.purchasedQuantity,
      input.committedQuantity - input.purchasedQuantity,
      input.actualUnitPriceMinor,
      input.estimatedSubtotalMinor,
      input.purchasedQuantity * input.actualUnitPriceMinor,
    );
  }
  insertAllocationStatement(input: {
    commitmentId: string;
    purchaseBatchId: string;
    groupingId: string;
    orderItemId: string;
    committedQuantity: number;
    fulfilledQuantity: number;
    shortageQuantity: number;
    finalAmountMinor: number;
  }) {
    return this.statement(
      `INSERT INTO purchase_allocations(batch_commitment_id,purchase_batch_id,group_buy_batch_id,order_item_id,committed_quantity_snapshot,fulfilled_quantity,shortage_quantity,final_amount_minor)
       VALUES (?,?,?,?,?,?,?,?)`,
      input.commitmentId,
      input.purchaseBatchId,
      input.groupingId,
      input.orderItemId,
      input.committedQuantity,
      input.fulfilledQuantity,
      input.shortageQuantity,
      input.finalAmountMinor,
    );
  }
  finalizeAuditStatement(input: {
    id: string;
    purchaseBatchId: string;
    communityId: string;
    actorUserId: string;
    metadata: Record<string, unknown>;
  }) {
    return this.statement(
      `INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
       VALUES (?,?,?,'order_status_changed','purchase_batch',?,?)`,
      input.id,
      input.actorUserId,
      input.communityId,
      input.purchaseBatchId,
      JSON.stringify(input.metadata),
    );
  }
  async procurementForOrder(orderId: string) {
    return (
      (
        await this.statement(
          `SELECT oi.id AS order_item_id,oi.quantity AS ordered_quantity,
           COALESCE(SUM(pa.committed_quantity_snapshot),0) AS finalized_quantity,
           COALESCE(SUM(pa.fulfilled_quantity),0) AS fulfilled_quantity,
           COALESCE(SUM(pa.shortage_quantity),0) AS shortage_quantity,
           COALESCE(SUM(pa.final_amount_minor),0) AS final_payable_minor
           FROM order_items oi LEFT JOIN purchase_allocations pa ON pa.order_item_id=oi.id
           WHERE oi.order_id=? GROUP BY oi.id ORDER BY oi.created_at,oi.id`,
          orderId,
        ).all<Record<string, unknown>>()
      ).results ?? []
    );
  }
}

export class AdminOperationsRepository extends RepositoryBase {
  private aggregate(whereClause: string, communityIds: string[] = []) {
    return this.statement(
      `SELECT
      COALESCE(SUM(CASE WHEN o.status IN ('pending','submitted','partially_formed') THEN 1 ELSE 0 END),0) AS collecting,
      COALESCE(SUM(CASE WHEN o.status='formed' THEN 1 ELSE 0 END),0) AS grouped_ready,
      COALESCE(SUM(CASE WHEN o.status='formed' THEN 1 ELSE 0 END),0) AS pending_purchase,
      COALESCE(SUM(CASE WHEN o.status='ready_for_pickup' THEN 1 ELSE 0 END),0) AS pending_pickup,
      COALESCE(SUM(CASE WHEN o.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END),0) AS unfinished_orders
      FROM orders o ${whereClause}`,
      ...communityIds,
    ).first<OperationsSummaryRow>();
  }
  summaryGlobal() {
    return this.aggregate('');
  }
  summaryForCommunities(communityIds: string[]) {
    if (communityIds.length === 0) return Promise.resolve(null);
    const placeholders = communityIds.map(() => '?').join(',');
    return this.aggregate(
      `WHERE o.community_id IN (${placeholders})`,
      communityIds,
    );
  }
  summary(communityId: string) {
    return this.summaryForCommunities([communityId]);
  }
  async recentOrders(communityId: string, limit = 10): Promise<OrderRow[]> {
    return (
      (
        await this.statement(
          'SELECT * FROM orders WHERE community_id=? ORDER BY created_at DESC,id DESC LIMIT ?',
          communityId,
          limit,
        ).all<OrderRow>()
      ).results ?? []
    );
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
  readonly products: ProductRepository;
  readonly offerings: CommunityOfferingRepository;
  readonly batches: GroupBuyBatchRepository;
  readonly wishes: ProductWishRepository;
  readonly orders: OrderRepository;
  readonly pickups: PickupRepository;
  readonly reconciliation: ReconciliationRepository;
  readonly operations: AdminOperationsRepository;
  readonly purchaseBatches: PurchaseBatchRepository;
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
    this.orders = new OrderRepository(context);
    this.pickups = new PickupRepository(context);
    this.reconciliation = new ReconciliationRepository(context);
    this.operations = new AdminOperationsRepository(context);
    this.purchaseBatches = new PurchaseBatchRepository(context);
  }
  batch(statements: SqlStatement[]) {
    return this.context.db.batch(statements);
  }
}
