import { createId } from '../../domain/ids.ts';
import { deriveProcurementState } from '../../domain/procurement.ts';
import { deriveFulfillment, requirePayableFulfillment } from '../../domain/fulfillment.ts';
import { ApiError } from '../api-error.ts';
import { Repositories, type OrderRow } from '../repositories/index.ts';
import { requireActiveUser, isProfileComplete } from './index.ts';

async function requireManager(
  repositories: Repositories,
  userId: string | null,
  communityId: string,
) {
  const actor = await requireActiveUser(repositories, userId);
  if (!(await repositories.communities.findById(communityId)))
    throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
  if (await repositories.platformRoles.isPlatformAdmin(actor.id)) return actor;
  const membership = await repositories.members.find(actor.id, communityId);
  if (
    !membership ||
    membership.status !== 'active' ||
    membership.role !== 'community_admin'
  )
    throw new ApiError(403, 'COMMUNITY_ADMIN_REQUIRED', '需要該社區管理員權限');
  return actor;
}

export interface CreateOrderInput {
  communityId: string;
  idempotencyKey: string;
  items: Array<{ offeringId: string; quantity: number }>;
}

export class OrderService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  private async detail(order: OrderRow, includeContact = false) {
    const items = await this.repositories.orders.listItems(order.id);
    const pickup = await this.repositories.pickups.findByOrderId(order.id);
    const community = await this.repositories.communities.findById(
      order.community_id,
    );
    const procurementRows =
      await this.repositories.purchaseBatches.procurementForOrder(order.id);
    const procurementByItem = new Map(
      procurementRows.map((row) => [String(row.order_item_id), row]),
    );
    const publicItems = items.map((item) => {
      const procurement = procurementByItem.get(item.id);
      const finalizedQuantity = Number(procurement?.finalized_quantity ?? 0);
      return {
        ...item,
        procurement: {
          state: deriveProcurementState(item.quantity, finalizedQuantity),
          fulfilledQuantity: Number(procurement?.fulfilled_quantity ?? 0),
          shortageQuantity: Number(procurement?.shortage_quantity ?? 0),
          finalPayableMinor: Number(procurement?.final_payable_minor ?? 0),
        },
      };
    });
    const paymentStatus = (await this.repositories.pickups.findFulfillment(order.id))?.payment_status === 'paid' ? 'paid' : 'unpaid';
    const pickupStatus = pickup?.status === 'picked_up' ? 'handed_over' : 'pending';
    const fulfillment = deriveFulfillment({
      orderedQuantity: publicItems.reduce((sum, item) => sum + item.quantity, 0),
      finalizedQuantity: procurementRows.reduce((sum, row) => sum + Number(row.finalized_quantity ?? 0), 0),
      fulfilledQuantity: publicItems.reduce((sum, item) => sum + item.procurement.fulfilledQuantity, 0),
      finalPayableMinor: publicItems.reduce((sum, item) => sum + item.procurement.finalPayableMinor, 0),
      paymentStatus,
      pickupStatus,
    });
    const publicOrder: Record<string, unknown> = {
      id: order.id,
      userId: order.user_id,
      communityId: order.community_id,
      communityName: community?.name ?? null,
      status: order.status,
      currency: order.currency,
      estimatedTotalMinor: order.estimated_total_minor,
      actualTotalMinor: order.actual_total_minor,
      createdAt: order.created_at,
      items: publicItems,
      fulfillment: {
        ...fulfillment,
        paymentStatus,
        pickupStatus,
        pickupLocation: pickup?.pickup_location_snapshot ?? null,
        pickupWindow: pickup?.pickup_window_snapshot ?? null,
      },
    };
    if (includeContact)
      publicOrder.contact = {
        name: order.contact_name_snapshot,
        phone: order.contact_phone_snapshot,
      };
    return publicOrder;
  }

  async create(userId: string | null, input: CreateOrderInput) {
    const actor = await requireActiveUser(this.repositories, userId);
    const existing = await this.repositories.orders.findByUserIdempotency(
      actor.id,
      input.idempotencyKey,
    );
    if (existing) return { created: false, order: await this.detail(existing) };
    const profile = await this.repositories.profiles.findByUserId(actor.id);
    if (!profile || !isProfileComplete(profile))
      throw new ApiError(422, 'PROFILE_INCOMPLETE', '下單前需完成姓名與電話');
    const community = await this.repositories.communities.findById(
      input.communityId,
    );
    if (!community || community.status !== 'active')
      throw new ApiError(422, 'COMMUNITY_INACTIVE', '社區目前不可下單');
    const membership = await this.repositories.members.find(
      actor.id,
      input.communityId,
    );
    if (!membership || membership.status !== 'active')
      throw new ApiError(403, 'MEMBERSHIP_REQUIRED', '必須是社區會員');
    const seen = new Set<string>();
    const itemData = [];
    let total = 0;
    let currency: string | null = null;
    for (const item of input.items) {
      if (seen.has(item.offeringId))
        throw new ApiError(
          422,
          'DUPLICATE_OFFERING',
          '同一訂單不可重複 offering',
        );
      seen.add(item.offeringId);
      const offering = await this.repositories.offerings.findOrderableDetails(
        input.communityId,
        item.offeringId,
      );
      if (
        !offering ||
        offering.status !== 'active' ||
        offering.product_status !== 'active'
      )
        throw new ApiError(422, 'OFFERING_INACTIVE', '商品目前不可下單');
      const min = Number(offering.min_quantity_per_order),
        max =
          offering.max_quantity_per_order === null
            ? null
            : Number(offering.max_quantity_per_order);
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < min ||
        (max !== null && item.quantity > max)
      )
        throw new ApiError(
          422,
          'QUANTITY_OUT_OF_RANGE',
          '數量不符合 offering 限制',
        );
      if (currency !== null && currency !== offering.currency)
        throw new ApiError(422, 'MIXED_CURRENCY', '一張訂單不可混用幣別');
      currency = String(offering.currency);
      const subtotal = Number(offering.price_minor) * item.quantity;
      if (
        !Number.isSafeInteger(subtotal) ||
        !Number.isSafeInteger(total + subtotal)
      )
        throw new ApiError(422, 'TOTAL_OUT_OF_RANGE', '訂單金額超出範圍');
      total += subtotal;
      itemData.push({
        ...item,
        id: createId(),
        productId: String(offering.product_id),
        productName: String(offering.product_name),
        unitLabel: String(offering.unit_label),
        unitPrice: Number(offering.price_minor),
      });
    }
    const orderId = createId();
    const statements = [
      this.repositories.orders.insertStatement({
        id: orderId,
        userId: actor.id,
        communityId: input.communityId,
        total,
        currency: currency!,
        key: input.idempotencyKey,
        contactName: profile.display_name!,
        contactPhone: profile.phone!,
      }),
    ];
    for (const item of itemData) {
      statements.push(
        this.repositories.orders.insertItemStatement({
          id: item.id,
          orderId,
          offeringId: item.offeringId,
          productId: item.productId,
          productName: item.productName,
          unitLabel: item.unitLabel,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        }),
      );
      statements.push(
        ...this.repositories.batches.allocationStatements({
          requestId: `order-${item.id}`,
          offeringId: item.offeringId,
          quantity: item.quantity,
          actorUserId: actor.id,
          orderItemId: item.id,
        }),
      );
    }
    statements.push(
      this.repositories.orders.deriveAffectedStatusesStatement(orderId),
    );
    statements.push(
      this.repositories.audits.insertStatement({
        id: createId(),
        actorUserId: actor.id,
        communityId: input.communityId,
        actionType: 'order_created',
        targetType: 'order',
        targetId: orderId,
        metadata: { itemCount: itemData.length, estimatedTotalMinor: total },
      }),
    );
    try {
      await this.repositories.batch(statements);
    } catch (error) {
      const winner = await this.repositories.orders.findByUserIdempotency(
        actor.id,
        input.idempotencyKey,
      );
      if (winner) return { created: false, order: await this.detail(winner) };
      throw error;
    }
    return {
      created: true,
      order: await this.detail(
        (await this.repositories.orders.findById(orderId))!,
      ),
    };
  }

  async listMine(userId: string | null) {
    const actor = await requireActiveUser(this.repositories, userId);
    return Promise.all(
      (await this.repositories.orders.listForUser(actor.id)).map((order) =>
        this.detail(order),
      ),
    );
  }
  async getMine(userId: string | null, orderId: string) {
    const actor = await requireActiveUser(this.repositories, userId);
    const order = await this.repositories.orders.findById(orderId);
    if (!order || order.user_id !== actor.id)
      throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到訂單');
    return this.detail(order);
  }
  async listCommunity(userId: string | null, communityId: string) {
    await requireManager(this.repositories, userId, communityId);
    return Promise.all(
      (await this.repositories.orders.listForCommunity(communityId)).map(
        (order) => this.detail(order, true),
      ),
    );
  }
  async getCommunity(
    userId: string | null,
    communityId: string,
    orderId: string,
  ) {
    await requireManager(this.repositories, userId, communityId);
    const order = await this.repositories.orders.findById(orderId);
    if (!order || order.community_id !== communityId)
      throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到此社區訂單');
    return this.detail(order, true);
  }

  async cancel(
    userId: string | null,
    orderId: string,
    reason: string,
    adminCommunityId?: string,
  ) {
    const order = await this.repositories.orders.findById(orderId);
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到訂單');
    const actor = adminCommunityId
      ? await requireManager(this.repositories, userId, adminCommunityId)
      : await requireActiveUser(this.repositories, userId);
    if (adminCommunityId && order.community_id !== adminCommunityId)
      throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到此社區訂單');
    if (!adminCommunityId && order.user_id !== actor.id)
      throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到訂單');
    if (order.status === 'cancelled')
      return this.detail(order, Boolean(adminCommunityId));
    if (order.status === 'completed' || order.status === 'ready_for_pickup')
      throw new ApiError(409, 'ORDER_NOT_CANCELLABLE', '此訂單狀態不可取消');
    if (!adminCommunityId && order.status === 'formed')
      throw new ApiError(
        409,
        'ADMIN_CANCELLATION_REQUIRED',
        '已成團訂單需要管理員處理',
      );
    if (await this.repositories.orders.hasLockedCommitments(orderId))
      throw new ApiError(409, 'BATCH_LOCKED', '批次已鎖定，不可取消');
    await this.repositories.batch([
      this.repositories.orders.cancelStatement(
        orderId,
        actor.id,
        reason,
        Boolean(adminCommunityId),
      ),
      this.repositories.orders.cancelCommitmentsStatement(orderId),
      this.repositories.orders.recalculateBatchesStatement(orderId),
      this.repositories.orders.deriveAffectedStatusesStatement(orderId),
      this.repositories.audits.insertStatement({
        id: createId(),
        actorUserId: actor.id,
        communityId: order.community_id,
        actionType: adminCommunityId
          ? 'admin_order_cancelled'
          : 'order_cancelled',
        targetType: 'order',
        targetId: orderId,
        metadata: { statusFrom: order.status, statusTo: 'cancelled' },
      }),
      this.repositories.audits.insertStatement({
        id: createId(),
        actorUserId: actor.id,
        communityId: order.community_id,
        actionType: 'order_status_changed',
        targetType: 'order',
        targetId: orderId,
        metadata: { from: order.status, to: 'cancelled' },
      }),
    ]);
    const cancelled = await this.repositories.orders.findById(orderId);
    if (cancelled?.status !== 'cancelled')
      throw new ApiError(409, 'ORDER_NOT_CANCELLABLE', '訂單狀態已變更');
    return this.detail(cancelled, Boolean(adminCommunityId));
  }
}

export class PickupService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }
  private async detail(communityId: string, orderId: string) {
    const row = await this.repositories.pickups.findFulfillment(orderId);
    if (!row || row.community_id !== communityId)
      throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到此社區訂單');
    const paymentStatus = row.payment_status === 'paid' ? 'paid' : 'unpaid';
    const pickupStatus = row.pickup_status === 'picked_up' ? 'handed_over' : 'pending';
    const derived = deriveFulfillment({
      orderedQuantity: Number(row.ordered_quantity),
      finalizedQuantity: Number(row.finalized_quantity),
      fulfilledQuantity: Number(row.fulfilled_quantity),
      finalPayableMinor: Number(row.final_payable_minor),
      paymentStatus,
      pickupStatus,
    });
    const pickup = await this.repositories.pickups.findByOrderId(orderId);
    return {
      orderId: row.id,
      communityId: row.community_id,
      memberDisplayName: row.display_name,
      currency: row.currency,
      orderedQuantity: Number(row.ordered_quantity),
      finalizedQuantity: Number(row.finalized_quantity),
      fulfilledQuantity: Number(row.fulfilled_quantity),
      shortageQuantity: Number(row.shortage_quantity),
      finalPayableMinor: Number(row.final_payable_minor),
      paymentStatus,
      pickupStatus,
      pickupLocation: pickup?.pickup_location_snapshot ?? null,
      pickupWindow: pickup?.pickup_window_snapshot ?? null,
      ...derived,
      items: await this.repositories.pickups.listFulfillmentItems(orderId),
    };
  }
  async list(userId: string | null, communityId: string) {
    await requireManager(this.repositories, userId, communityId);
    const rows = await this.repositories.pickups.listFulfillments(communityId);
    return Promise.all(rows.map((row) => this.detail(communityId, row.id)));
  }
  async get(userId: string | null, communityId: string, orderId: string) {
    await requireManager(this.repositories, userId, communityId);
    return this.detail(communityId, orderId);
  }
  async confirmPayment(userId: string | null, communityId: string, orderId: string) {
    const actor = await requireManager(this.repositories, userId, communityId);
    const current = await this.detail(communityId, orderId);
    const eligibility = requirePayableFulfillment({
      orderedQuantity: current.orderedQuantity,
      finalizedQuantity: current.finalizedQuantity,
      fulfilledQuantity: current.fulfilledQuantity,
      finalPayableMinor: current.finalPayableMinor,
    });
    if (eligibility)
      throw new ApiError(409, eligibility, eligibility === 'PROCUREMENT_NOT_FINALIZED' ? '採購結果尚未全部確認' : '此訂單無需收款或取貨');
    if (current.paymentStatus === 'paid') return current;
    const results = await this.repositories.batch([
      this.repositories.pickups.paymentStatement(orderId, communityId, current.finalPayableMinor, actor.id),
      this.repositories.pickups.paymentAuditStatement(createId(), actor.id, communityId, orderId, current.finalPayableMinor),
      this.repositories.pickups.prepareStatement(createId(), orderId, communityId, '社區指定地點', '請依社區通知'),
      this.repositories.pickups.fulfillmentOrderReadyStatement(orderId),
    ]);
    if (Number((results[0]?.meta as { changes?: unknown } | undefined)?.changes ?? 0) === 0)
      return this.detail(communityId, orderId);
    return this.detail(communityId, orderId);
  }
  async confirmHandover(userId: string | null, communityId: string, orderId: string) {
    const actor = await requireManager(this.repositories, userId, communityId);
    const current = await this.detail(communityId, orderId);
    if (!current.procurementResolved)
      throw new ApiError(409, 'PROCUREMENT_NOT_FINALIZED', '採購結果尚未全部確認');
    if (!current.requiresPickup)
      throw new ApiError(409, 'NO_PICKUP_REQUIRED', '此訂單無需取貨');
    if (current.paymentStatus !== 'paid')
      throw new ApiError(409, 'PAYMENT_REQUIRED', '請先確認收到現金');
    if (current.pickupStatus === 'handed_over') return current;
    const results = await this.repositories.batch([
      this.repositories.pickups.handoverStatement(orderId, actor.id),
      this.repositories.pickups.handoverAuditStatement(createId(), actor.id, communityId, orderId),
      this.repositories.pickups.fulfillmentOrderCompleteStatement(orderId),
    ]);
    if (Number((results[0]?.meta as { changes?: unknown } | undefined)?.changes ?? 0) === 0) {
      const winner = await this.detail(communityId, orderId);
      if (winner.pickupStatus === 'handed_over') return winner;
      throw new ApiError(409, 'HANDOVER_CONFLICT', '取貨狀態已變更');
    }
    return this.detail(communityId, orderId);
  }
  async markReady(userId: string | null, communityId: string, orderId: string) {
    const actor = await requireManager(this.repositories, userId, communityId);
    const order = await this.repositories.orders.findById(orderId);
    if (!order || order.community_id !== communityId)
      throw new ApiError(404, 'ORDER_NOT_FOUND', '找不到此社區訂單');
    if (order.status !== 'formed')
      throw new ApiError(409, 'ORDER_NOT_FORMED', '訂單尚未全部成團');
    const fulfillment = await this.detail(communityId, orderId);
    if (!fulfillment.procurementResolved || !fulfillment.requiresPickup)
      throw new ApiError(409, 'PROCUREMENT_NOT_FINALIZED', '採購結果尚未全部確認');
    const pickupId = createId();
    await this.repositories.batch([
      this.repositories.pickups.lockBatchesStatement(orderId),
      this.repositories.pickups.createStatement(pickupId, orderId, communityId),
      this.repositories.pickups.readyStatement(orderId),
      this.repositories.pickups.orderReadyStatement(orderId),
      this.repositories.audits.insertStatement({
        id: createId(),
        actorUserId: actor.id,
        communityId,
        actionType: 'pickup_created',
        targetType: 'pickup',
        targetId: pickupId,
      }),
      this.repositories.audits.insertStatement({
        id: createId(),
        actorUserId: actor.id,
        communityId,
        actionType: 'pickup_ready',
        targetType: 'order',
        targetId: orderId,
      }),
      this.repositories.audits.insertStatement({
        id: createId(),
        actorUserId: actor.id,
        communityId,
        actionType: 'order_status_changed',
        targetType: 'order',
        targetId: orderId,
        metadata: { from: 'formed', to: 'ready_for_pickup' },
      }),
    ]);
    return this.repositories.pickups.findByOrderId(orderId);
  }
  async complete(userId: string | null, communityId: string, orderId: string) {
    return this.confirmHandover(userId, communityId, orderId);
  }
}

export class ReconciliationService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }
  inspect(orderId: string) {
    return this.repositories.reconciliation.inspect(orderId);
  }
}
