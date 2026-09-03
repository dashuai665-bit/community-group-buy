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
export interface OrderRow { id: string; user_id: string; community_id: string; status: string; currency: string; estimated_total_minor: number; actual_total_minor: number | null; idempotency_key: string; contact_name_snapshot: string; contact_phone_snapshot: string; cancel_reason: string | null }
export interface OrderItemRow { id: string; order_id: string; offering_id: string; product_id: string; product_name_snapshot: string; unit_label_snapshot: string; unit_price_minor: number; quantity: number; estimated_subtotal_minor: number }
export interface PickupRow { id: string; order_id: string; community_id: string; status: string; scheduled_at: string | null; ready_at: string | null; picked_up_at: string | null }

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
  findOrderableDetails(communityId: string, offeringId: string) {
    return this.statement(`SELECT o.id,o.community_id,o.product_id,o.status,o.price_minor,o.currency,o.batch_threshold,o.min_quantity_per_order,o.max_quantity_per_order,
      p.name AS product_name,p.unit_label,p.status AS product_status
      FROM community_product_offerings o JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.community_id=?`, offeringId, communityId).first<Record<string, unknown>>();
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
  allocationStatements(input: { requestId: string; offeringId: string; quantity: number; actorUserId: string; orderItemId?: string }): SqlStatement[] {
    const { requestId, offeringId, quantity, actorUserId, orderItemId } = input;
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
    ) INSERT OR IGNORE INTO batch_commitments (id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)
      SELECT ? || '-commit-' || sequence_number, ?, id, MIN(capacity, MAX(0, ?-prior_capacity)), ?, ?, ?, 'active'
      FROM capacities WHERE ? > prior_capacity AND capacity > 0`, offeringId, requestId, requestId, quantity, orderItemId ? 'order_item' : 'reservation', orderItemId ?? null, orderItemId ?? null, quantity);
    const refreshCache = this.statement(`UPDATE group_buy_batches SET committed_quantity=(SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active'),updated_at=CURRENT_TIMESTAMP WHERE offering_id=? AND status='open'`, offeringId);
    const formFull = this.statement("UPDATE group_buy_batches SET status='formed',formed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE offering_id=? AND status='open' AND committed_quantity=threshold_quantity", offeringId);
    const auditFormed = this.statement(`INSERT OR IGNORE INTO audit_logs (id,actor_user_id,community_id,action_type,target_type,target_id,metadata)
      SELECT ? || '-audit-' || b.id, ?, o.community_id, 'batch_formed', 'group_buy_batch', b.id,
        json_object('offeringId',o.id,'batchId',b.id,'quantity',b.committed_quantity,'threshold',b.threshold_quantity)
      FROM group_buy_batches b JOIN community_product_offerings o ON o.id=b.offering_id
      WHERE b.offering_id=? AND b.status='formed' AND EXISTS (SELECT 1 FROM batch_commitments c WHERE c.batch_id=b.id AND c.request_id=?)`, requestId, actorUserId, offeringId, requestId);
    return [ensureCapacity, insertLedger, refreshCache, formFull, auditFormed];
  }
}

export class OrderRepository extends RepositoryBase {
  findById(id: string) { return this.statement('SELECT * FROM orders WHERE id=?', id).first<OrderRow>(); }
  findByUserIdempotency(userId: string, key: string) { return this.statement('SELECT * FROM orders WHERE user_id=? AND idempotency_key=?', userId, key).first<OrderRow>(); }
  async listForUser(userId: string): Promise<OrderRow[]> { return (await this.statement('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC,id DESC', userId).all<OrderRow>()).results ?? []; }
  async listForCommunity(communityId: string): Promise<OrderRow[]> { return (await this.statement('SELECT * FROM orders WHERE community_id=? ORDER BY created_at DESC,id DESC', communityId).all<OrderRow>()).results ?? []; }
  async listItems(orderId: string): Promise<OrderItemRow[]> { return (await this.statement('SELECT * FROM order_items WHERE order_id=? ORDER BY created_at,id', orderId).all<OrderItemRow>()).results ?? []; }
  insertStatement(input: { id: string; userId: string; communityId: string; total: number; currency: string; key: string; contactName: string; contactPhone: string }) {
    return this.statement("INSERT INTO orders(id,user_id,community_id,status,currency,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot) VALUES (?,?,?,'submitted',?,?,?,?,?)", input.id,input.userId,input.communityId,input.currency,input.total,input.key,input.contactName,input.contactPhone);
  }
  insertItemStatement(input: { id: string; orderId: string; offeringId: string; productId: string; productName: string; unitLabel: string; unitPrice: number; quantity: number }) {
    return this.statement('INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor) VALUES (?,?,?,?,?,?,?,?,?)', input.id,input.orderId,input.offeringId,input.productId,input.productName,input.unitLabel,input.unitPrice,input.quantity,input.unitPrice*input.quantity);
  }
  deriveStatusStatement(orderId: string) {
    return this.statement(`UPDATE orders SET status=CASE
      WHEN NOT EXISTS (SELECT 1 FROM order_items oi JOIN batch_commitments bc ON bc.order_item_id=oi.id AND bc.status='active' JOIN group_buy_batches b ON b.id=bc.batch_id WHERE oi.order_id=orders.id AND b.status NOT IN ('formed','locked','closed')) THEN 'formed'
      WHEN EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=orders.id AND NOT EXISTS (SELECT 1 FROM batch_commitments bc JOIN group_buy_batches b ON b.id=bc.batch_id WHERE bc.order_item_id=oi.id AND bc.status='active' AND b.status NOT IN ('formed','locked','closed'))) THEN 'partially_formed'
      ELSE 'submitted' END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('cancelled','ready_for_pickup','completed')`, orderId);
  }
  cancelCommitmentsStatement(orderId: string) { return this.statement("UPDATE batch_commitments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP WHERE status='active' AND order_item_id IN (SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.order_id=? AND o.status='cancelled')", orderId); }
  recalculateBatchesStatement(orderId: string) { return this.statement(`UPDATE group_buy_batches SET committed_quantity=(SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active'),status=CASE WHEN status='formed' AND (SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active') < threshold_quantity THEN 'open' ELSE status END,formed_at=CASE WHEN status='formed' AND (SELECT COALESCE(SUM(quantity),0) FROM batch_commitments WHERE batch_id=group_buy_batches.id AND status='active') < threshold_quantity THEN NULL ELSE formed_at END,updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT bc.batch_id FROM batch_commitments bc JOIN order_items oi ON oi.id=bc.order_item_id WHERE oi.order_id=?) AND status IN ('open','formed')`, orderId); }
  deriveAffectedStatusesStatement(orderId:string){return this.statement(`UPDATE orders SET status=CASE
    WHEN NOT EXISTS (SELECT 1 FROM order_items oi JOIN batch_commitments bc ON bc.order_item_id=oi.id AND bc.status='active' JOIN group_buy_batches b ON b.id=bc.batch_id WHERE oi.order_id=orders.id AND b.status NOT IN ('formed','locked','closed')) THEN 'formed'
    WHEN EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=orders.id AND NOT EXISTS (SELECT 1 FROM batch_commitments bc JOIN group_buy_batches b ON b.id=bc.batch_id WHERE bc.order_item_id=oi.id AND bc.status='active' AND b.status NOT IN ('formed','locked','closed'))) THEN 'partially_formed' ELSE 'submitted' END,updated_at=CURRENT_TIMESTAMP
    WHERE status IN ('submitted','partially_formed','formed') AND id IN (SELECT DISTINCT oi2.order_id FROM order_items oi2 JOIN batch_commitments bc2 ON bc2.order_item_id=oi2.id WHERE bc2.batch_id IN (SELECT bc3.batch_id FROM batch_commitments bc3 JOIN order_items oi3 ON oi3.id=bc3.order_item_id WHERE oi3.order_id=?))`,orderId);}
  cancelStatement(orderId: string, actorId: string, reason: string, admin: boolean) { return this.statement(`UPDATE orders SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN (${admin ? "'submitted','partially_formed','formed'" : "'submitted','partially_formed'"})`, actorId,reason,orderId); }
  hasLockedCommitments(orderId: string) { return this.statement("SELECT 1 AS found FROM order_items oi JOIN batch_commitments bc ON bc.order_item_id=oi.id AND bc.status='active' JOIN group_buy_batches b ON b.id=bc.batch_id WHERE oi.order_id=? AND b.status IN ('locked','closed') LIMIT 1", orderId).first(); }
  async hasUnfinishedForCommunity(userId: string, communityId: string): Promise<boolean> { return Boolean(await this.statement("SELECT 1 FROM orders o LEFT JOIN pickup_records p ON p.order_id=o.id WHERE o.user_id=? AND o.community_id=? AND (o.status IN ('submitted','partially_formed','formed','ready_for_pickup') OR p.status IN ('pending','ready')) LIMIT 1", userId,communityId).first()); }
}

export class PickupRepository extends RepositoryBase {
  findByOrderId(orderId: string) { return this.statement('SELECT * FROM pickup_records WHERE order_id=?', orderId).first<PickupRow>(); }
  createStatement(id: string, orderId: string, communityId: string) { return this.statement("INSERT INTO pickup_records(id,order_id,community_id,status) VALUES (?,?,?,'pending')", id,orderId,communityId); }
  readyStatement(orderId: string) { return this.statement("UPDATE pickup_records SET status='ready',ready_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='pending'", orderId); }
  completeStatement(orderId: string) { return this.statement("UPDATE pickup_records SET status='picked_up',picked_up_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='ready'", orderId); }
  orderReadyStatement(orderId: string) { return this.statement("UPDATE orders SET status='ready_for_pickup',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='formed'", orderId); }
  orderCompleteStatement(orderId: string) { return this.statement("UPDATE orders SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ready_for_pickup'", orderId); }
  lockBatchesStatement(orderId: string) { return this.statement("UPDATE group_buy_batches SET status='locked',updated_at=CURRENT_TIMESTAMP WHERE status='formed' AND id IN (SELECT bc.batch_id FROM batch_commitments bc JOIN order_items oi ON oi.id=bc.order_item_id WHERE oi.order_id=? AND bc.status='active')", orderId); }
}

export class ReconciliationRepository extends RepositoryBase {
  async inspect(orderId: string) {
    const itemDrift=(await this.statement("SELECT oi.id,CASE WHEN o.status='cancelled' THEN 0 ELSE oi.quantity END AS expected,COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity ELSE 0 END),0) AS committed FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN batch_commitments bc ON bc.order_item_id=oi.id WHERE oi.order_id=? GROUP BY oi.id HAVING expected<>committed",orderId).all()).results ?? [];
    const batchDrift=(await this.statement("SELECT b.id,b.committed_quantity,COALESCE(SUM(CASE WHEN bc.status='active' THEN bc.quantity ELSE 0 END),0) AS actual FROM group_buy_batches b LEFT JOIN batch_commitments bc ON bc.batch_id=b.id WHERE b.id IN (SELECT bc2.batch_id FROM batch_commitments bc2 JOIN order_items oi ON oi.id=bc2.order_item_id WHERE oi.order_id=?) GROUP BY b.id HAVING b.committed_quantity<>actual",orderId).all()).results ?? [];
    const totalDrift=(await this.statement("SELECT o.id,o.estimated_total_minor,COALESCE(SUM(oi.estimated_subtotal_minor),0) AS actual FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.id=? GROUP BY o.id HAVING o.estimated_total_minor<>actual",orderId).all()).results ?? [];
    return { ok: itemDrift.length===0&&batchDrift.length===0&&totalDrift.length===0,itemDrift,batchDrift,totalDrift };
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
  readonly orders: OrderRepository;
  readonly pickups: PickupRepository;
  readonly reconciliation: ReconciliationRepository;
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
  }
  batch(statements: SqlStatement[]) { return this.context.db.batch(statements); }
}
