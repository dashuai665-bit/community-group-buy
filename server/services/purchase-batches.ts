import {
  calculateEstimatedPurchaseTotals,
  canStartPurchasing,
  validateGroupingSelection,
} from '../../domain/purchase-batches.ts';
import { createId } from '../../domain/ids.ts';
import { ApiError } from '../api-error.ts';
import { Repositories } from '../repositories/index.ts';
import { requireActiveUser } from './index.ts';

export class PurchaseBatchService {
  private readonly repositories: Repositories;
  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  private async requireManager(userId: string | null, communityId: string) {
    const actor = await requireActiveUser(this.repositories, userId);
    if (!(await this.repositories.communities.findById(communityId)))
      throw new ApiError(404, 'COMMUNITY_NOT_FOUND', '找不到此社區');
    if (await this.repositories.platformRoles.isPlatformAdmin(actor.id))
      return actor;
    const membership = await this.repositories.members.find(
      actor.id,
      communityId,
    );
    if (
      !membership ||
      membership.status !== 'active' ||
      membership.role !== 'community_admin'
    )
      throw new ApiError(
        403,
        'COMMUNITY_ADMIN_REQUIRED',
        '需要該社區管理員權限',
      );
    return actor;
  }

  private async detail(communityId: string, purchaseBatchId: string) {
    const batch = await this.repositories.purchaseBatches.findById(
      communityId,
      purchaseBatchId,
    );
    if (!batch)
      throw new ApiError(404, 'PURCHASE_BATCH_NOT_FOUND', '找不到此採購批次');
    const groups =
      await this.repositories.purchaseBatches.listGroups(purchaseBatchId);
    const totals = calculateEstimatedPurchaseTotals(
      groups.map((group) => ({
        quantity: Number(group.committed_quantity),
        estimatedAmountMinor: Number(group.estimated_amount_minor),
      })),
    );
    return { ...batch, groups, ...totals };
  }

  private async requireEquivalentIdempotentRequest(
    purchaseBatchId: string,
    requestedGroupingIds: string[],
  ) {
    const existingGroupingIds = (
      await this.repositories.purchaseBatches.listGroups(purchaseBatchId)
    )
      .map((group) => String(group.id))
      .sort();
    const canonicalRequestedGroupingIds = [...requestedGroupingIds].sort();
    if (
      existingGroupingIds.length !== canonicalRequestedGroupingIds.length ||
      existingGroupingIds.some(
        (groupingId, index) =>
          groupingId !== canonicalRequestedGroupingIds[index],
      )
    )
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        '此冪等鍵已用於不同的採購批次內容',
      );
  }

  async list(userId: string | null, communityId: string) {
    await this.requireManager(userId, communityId);
    return {
      eligibleGroups:
        await this.repositories.purchaseBatches.listEligibleGroups(communityId),
      purchaseBatches:
        await this.repositories.purchaseBatches.listForCommunity(communityId),
    };
  }

  async get(
    userId: string | null,
    communityId: string,
    purchaseBatchId: string,
  ) {
    await this.requireManager(userId, communityId);
    return this.detail(communityId, purchaseBatchId);
  }

  async create(
    userId: string | null,
    communityId: string,
    input: { groupingIds: string[]; idempotencyKey: string },
  ) {
    const actor = await this.requireManager(userId, communityId);
    let groupingIds: string[];
    try {
      groupingIds = validateGroupingSelection(input.groupingIds);
    } catch (error) {
      throw new ApiError(
        400,
        String((error as Error).message),
        '必須選擇不重複的已成團集單',
      );
    }
    const existing = await this.repositories.purchaseBatches.findByIdempotency(
      communityId,
      input.idempotencyKey,
    );
    if (existing) {
      await this.requireEquivalentIdempotentRequest(existing.id, groupingIds);
      return {
        created: false,
        purchaseBatch: await this.detail(communityId, existing.id),
      };
    }
    const groupings = await this.repositories.purchaseBatches.findGroupings(
      communityId,
      groupingIds,
    );
    if (groupings.length !== groupingIds.length)
      throw new ApiError(404, 'GROUPING_NOT_FOUND', '找不到其中一個社區集單');
    if (groupings.some((grouping) => grouping.status !== 'formed'))
      throw new ApiError(
        409,
        'GROUPING_NOT_ELIGIBLE',
        '只有已成團集單可建立採購批次',
      );
    if (
      (await this.repositories.purchaseBatches.assignedGroupingIds(groupingIds))
        .length
    )
      throw new ApiError(
        409,
        'GROUPING_ALREADY_ASSIGNED',
        '集單已屬於其他採購批次',
      );
    const eligible =
      await this.repositories.purchaseBatches.listEligibleGroups(communityId);
    const selected = eligible.filter((group) =>
      groupingIds.includes(String(group.id)),
    );
    const totals = calculateEstimatedPurchaseTotals(
      selected.map((group) => ({
        quantity: Number(group.committed_quantity),
        estimatedAmountMinor: Number(group.estimated_amount_minor),
      })),
    );
    const id = createId();
    try {
      await this.repositories.batch([
        this.repositories.purchaseBatches.insertStatement({
          id,
          communityId,
          idempotencyKey: input.idempotencyKey,
          actorUserId: actor.id,
        }),
        ...groupingIds.map((groupingId) =>
          this.repositories.purchaseBatches.insertGroupStatement(
            id,
            groupingId,
          ),
        ),
        this.repositories.audits.insertStatement({
          id: createId(),
          actorUserId: actor.id,
          communityId,
          actionType: 'order_status_changed',
          targetType: 'purchase_batch',
          targetId: id,
          metadata: {
            event: 'PURCHASE_BATCH_CREATED',
            groupingIds,
            groupCount: groupingIds.length,
            totalEstimatedQuantity: totals.totalQuantity,
          },
        }),
      ]);
    } catch (error) {
      const winner = await this.repositories.purchaseBatches.findByIdempotency(
        communityId,
        input.idempotencyKey,
      );
      if (winner) {
        await this.requireEquivalentIdempotentRequest(winner.id, groupingIds);
        return {
          created: false,
          purchaseBatch: await this.detail(communityId, winner.id),
        };
      }
      if (
        (
          await this.repositories.purchaseBatches.assignedGroupingIds(
            groupingIds,
          )
        ).length
      )
        throw new ApiError(
          409,
          'GROUPING_ALREADY_ASSIGNED',
          '集單已屬於其他採購批次',
        );
      throw error;
    }
    return { created: true, purchaseBatch: await this.detail(communityId, id) };
  }

  async start(
    userId: string | null,
    communityId: string,
    purchaseBatchId: string,
  ) {
    const actor = await this.requireManager(userId, communityId);
    const batch = await this.repositories.purchaseBatches.findById(
      communityId,
      purchaseBatchId,
    );
    if (!batch)
      throw new ApiError(404, 'PURCHASE_BATCH_NOT_FOUND', '找不到此採購批次');
    if (!canStartPurchasing(batch.status))
      throw new ApiError(
        409,
        'PURCHASE_BATCH_NOT_READY',
        '採購批次無法開始採購',
      );
    const results = await this.repositories.batch([
      this.repositories.purchaseBatches.startStatement(
        purchaseBatchId,
        actor.id,
      ),
      this.repositories.purchaseBatches.startAuditStatement({
        id: `purchase-start-${purchaseBatchId}`,
        purchaseBatchId,
        communityId,
        actorUserId: actor.id,
      }),
    ]);
    const changes = Number(
      (results[0]?.meta as { changes?: unknown } | undefined)?.changes,
    );
    if (changes !== 1)
      throw new ApiError(
        409,
        'PURCHASE_BATCH_START_CONFLICT',
        '採購批次狀態已變更',
      );
    return this.detail(communityId, purchaseBatchId);
  }
}
