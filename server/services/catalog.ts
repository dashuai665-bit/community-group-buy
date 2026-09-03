import { createId } from '../../domain/ids.ts';
import { ApiError } from '../api-error.ts';
import { Repositories } from '../repositories/index.ts';
import { requireActiveUser } from './index.ts';

export type OfferingStatus = 'active' | 'paused' | 'ended';
export type WishStatus = 'open' | 'reviewing' | 'fulfilled' | 'rejected';

async function requireCommunityManager(repositories: Repositories, userId: string | null, communityId: string) {
  const actor = await requireActiveUser(repositories, userId);
  if (await repositories.platformRoles.isPlatformAdmin(actor.id)) return actor;
  const membership = await repositories.members.find(actor.id, communityId);
  if (!membership || membership.status !== 'active' || membership.role !== 'community_admin') {
    throw new ApiError(403, 'COMMUNITY_ADMIN_REQUIRED', '需要該社區管理員權限');
  }
  return actor;
}

export class ProductCatalogService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }
  async create(actorUserId: string | null, input: { name: string; description?: string | null; sourceType: string; sourceReference?: string | null; unitLabel: string; imageUrl?: string | null }) {
    const actor = await requireActiveUser(this.repositories, actorUserId);
    if (!(await this.repositories.platformRoles.isPlatformAdmin(actor.id))) throw new ApiError(403, 'PLATFORM_ADMIN_REQUIRED', '需要平台管理員權限');
    const id = createId();
    await this.repositories.batch([
      this.repositories.products.insertStatement({ id, ...input }),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, actionType: 'product_created', targetType: 'product', targetId: id }),
    ]);
    return this.repositories.products.findById(id);
  }
}

export class CommunityOfferingService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }

  async create(actorUserId: string | null, communityId: string, input: { productId: string; priceMinor: number; batchThreshold: number; minQuantity: number; maxQuantity?: number | null }) {
    const actor = await requireCommunityManager(this.repositories, actorUserId, communityId);
    const community = await this.repositories.communities.findById(communityId);
    if (!community || community.status !== 'active') throw new ApiError(422, 'COMMUNITY_INACTIVE', '社區目前不可建立 offering');
    const product = await this.repositories.products.findById(input.productId);
    if (!product || product.status !== 'active') throw new ApiError(422, 'PRODUCT_INACTIVE', '商品不存在或未啟用');
    const id = createId();
    try {
      await this.repositories.batch([
        this.repositories.offerings.insertStatement({ id, communityId, ...input }),
        this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'offering_created', targetType: 'community_product_offering', targetId: id }),
      ]);
    } catch {
      throw new ApiError(409, 'OFFERING_EXISTS', '此社區已提供該商品');
    }
    return this.repositories.offerings.findById(id);
  }

  async update(actorUserId: string | null, communityId: string, offeringId: string, input: { priceMinor: number; batchThreshold: number; minQuantity: number; maxQuantity?: number | null; status: OfferingStatus }) {
    const actor = await requireCommunityManager(this.repositories, actorUserId, communityId);
    const offering = await this.repositories.offerings.findById(offeringId);
    if (!offering || offering.community_id !== communityId) throw new ApiError(404, 'OFFERING_NOT_FOUND', '找不到此社區 offering');
    await this.repositories.batch([
      this.repositories.offerings.updateStatement({ id: offeringId, ...input }),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'offering_updated', targetType: 'community_product_offering', targetId: offeringId, metadata: { status: input.status, batchThreshold: input.batchThreshold } }),
    ]);
    return this.repositories.offerings.findById(offeringId);
  }
}

export class GroupBuyBatchService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }

  async findOrCreateOpenBatch(offeringId: string) {
    const existing = await this.repositories.batches.findOpen(offeringId);
    if (existing) return existing;
    const offering = await this.repositories.offerings.findById(offeringId);
    if (!offering || offering.status !== 'active') throw new ApiError(422, 'OFFERING_INACTIVE', 'offering 目前不可湊單');
    const batches = await this.repositories.batches.listForOffering(offeringId);
    const sequence = (batches.at(-1)?.sequence_number ?? 0) + 1;
    try {
      await this.repositories.batch([this.repositories.batches.createOpenStatement(createId(), offeringId, sequence, offering.batch_threshold)]);
    } catch {
      const winner = await this.repositories.batches.findOpen(offeringId);
      if (winner) return winner;
      throw new ApiError(409, 'BATCH_SEQUENCE_CONFLICT', '建立批次時發生衝突');
    }
    return this.repositories.batches.findOpen(offeringId);
  }

  async commitQuantity(actorUserId: string | null, communityId: string, offeringId: string, quantity: number, requestId = createId()) {
    const actor = await requireActiveUser(this.repositories, actorUserId);
    const membership = await this.repositories.members.find(actor.id, communityId);
    if (!membership || membership.status !== 'active') throw new ApiError(403, 'MEMBERSHIP_REQUIRED', '必須是社區會員才能提交數量');
    const offering = await this.repositories.offerings.findById(offeringId);
    if (!offering || offering.community_id !== communityId || offering.status !== 'active') throw new ApiError(404, 'OFFERING_NOT_FOUND', '找不到可湊單 offering');
    if (quantity < offering.min_quantity_per_order || (offering.max_quantity_per_order !== null && quantity > offering.max_quantity_per_order)) {
      throw new ApiError(422, 'QUANTITY_OUT_OF_RANGE', '數量不符合 offering 限制');
    }
    await this.repositories.batch(this.repositories.batches.allocationStatements({ requestId, offeringId, quantity, actorUserId: actor.id }));
    return this.repositories.batches.listForOffering(offeringId);
  }

  async openNextBatch(offeringId: string) { return this.findOrCreateOpenBatch(offeringId); }
  async formBatchWhenThresholdReached(offeringId: string) { return this.repositories.batches.listForOffering(offeringId); }
}

export class ProductWishService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) { this.repositories = repositories; }
  async create(actorUserId: string | null, communityId: string, input: { productId?: string | null; wishText?: string | null }) {
    const actor = await requireActiveUser(this.repositories, actorUserId);
    const community = await this.repositories.communities.findById(communityId);
    if (!community || community.status !== 'active') throw new ApiError(422, 'COMMUNITY_INACTIVE', '社區目前不可新增願望');
    const membership = await this.repositories.members.find(actor.id, communityId);
    if (!membership || membership.status !== 'active') throw new ApiError(403, 'MEMBERSHIP_REQUIRED', '必須是社區會員');
    if (!input.productId && !input.wishText?.trim()) throw new ApiError(422, 'WISH_CONTENT_REQUIRED', 'productId 或 wishText 至少需要一項');
    const id = createId();
    await this.repositories.batch([
      this.repositories.wishes.insertStatement({ id, userId: actor.id, communityId, ...input }),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'wish_created', targetType: 'product_wish', targetId: id }),
    ]);
    return this.repositories.wishes.findById(id);
  }
  async listMine(actorUserId: string | null) { const actor = await requireActiveUser(this.repositories, actorUserId); return this.repositories.wishes.listForUser(actor.id); }
  async listCommunity(actorUserId: string | null, communityId: string) { await requireCommunityManager(this.repositories, actorUserId, communityId); return this.repositories.wishes.listForCommunity(communityId); }
  async updateStatus(actorUserId: string | null, communityId: string, wishId: string, status: WishStatus) {
    const actor = await requireCommunityManager(this.repositories, actorUserId, communityId);
    const wish = await this.repositories.wishes.findById(wishId);
    if (!wish || wish.community_id !== communityId) throw new ApiError(404, 'WISH_NOT_FOUND', '找不到此社區願望');
    await this.repositories.batch([
      this.repositories.wishes.updateStatusStatement(wishId, status),
      this.repositories.audits.insertStatement({ id: createId(), actorUserId: actor.id, communityId, actionType: 'wish_status_changed', targetType: 'product_wish', targetId: wishId, metadata: { from: wish.status, to: status } }),
    ]);
    return this.repositories.wishes.findById(wishId);
  }
}
