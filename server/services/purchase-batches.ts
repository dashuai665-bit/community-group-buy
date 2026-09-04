import {
  calculateEstimatedPurchaseTotals,
  canStartPurchasing,
  validateGroupingSelection,
} from '../../domain/purchase-batches.ts';
import {
  allocateFifo,
  canonicalizeFinalizePayload,
} from '../../domain/procurement.ts';
import type { FinalizeResultInput } from '../../domain/procurement.ts';
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
    const finalization =
      await this.repositories.purchaseBatches.findFinalization(purchaseBatchId);
    return {
      ...batch,
      status: finalization ? 'finalized' : batch.status,
      groups,
      ...totals,
      finalization: finalization
        ? {
            committedQuantity: finalization.committed_quantity,
            purchasedQuantity: finalization.purchased_quantity,
            shortageQuantity: finalization.shortage_quantity,
            estimatedTotalMinor: finalization.estimated_total_minor,
            actualTotalMinor: finalization.actual_total_minor,
            receiptId: finalization.receipt_id,
            finalizedByUserId: finalization.finalized_by_user_id,
            finalizedAt: finalization.finalized_at,
          }
        : null,
    };
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
    const purchaseBatches =
      await this.repositories.purchaseBatches.listForCommunity(communityId);
    return {
      eligibleGroups:
        await this.repositories.purchaseBatches.listEligibleGroups(communityId),
      purchaseBatches: purchaseBatches.map((batch) => {
        const { display_status: displayStatus, ...publicBatch } = batch;
        return {
          ...publicBatch,
          status: displayStatus,
        };
      }),
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

  async createReceipt(
    userId: string | null,
    communityId: string,
    purchaseBatchId: string,
    input: { originalFilename: string; mimeType: string; sizeBytes: number },
  ) {
    const actor = await this.requireManager(userId, communityId);
    const batch = await this.repositories.purchaseBatches.findById(
      communityId,
      purchaseBatchId,
    );
    if (!batch)
      throw new ApiError(404, 'PURCHASE_BATCH_NOT_FOUND', '找不到此採購批次');
    if (batch.status !== 'purchasing')
      throw new ApiError(409, 'PURCHASE_BATCH_NOT_PURCHASING', '採購批次尚未開始採購');
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (
      !allowedMimeTypes.includes(input.mimeType) ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > 10 * 1024 * 1024
    )
      throw new ApiError(400, 'INVALID_RECEIPT_METADATA', '收據格式或大小不正確');
    const safeFilename = Array.from(input.originalFilename)
      .map((character) =>
        character === '/' || character === '\\' || character < ' '
          ? '_'
          : character,
      )
      .join('')
      .slice(0, 200);
    if (!safeFilename)
      throw new ApiError(400, 'INVALID_RECEIPT_METADATA', '收據檔名不正確');
    const id = createId();
    await this.repositories.batch([
      this.repositories.purchaseBatches.insertReceiptStatement({
        id,
        purchaseBatchId,
        storageKey: `receipts/${communityId}/${purchaseBatchId}/${id}`,
        originalFilename: safeFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        actorUserId: actor.id,
      }),
    ]);
    return { id, originalFilename: safeFilename, mimeType: input.mimeType, sizeBytes: input.sizeBytes };
  }

  async finalize(
    userId: string | null,
    communityId: string,
    purchaseBatchId: string,
    input: {
      results: FinalizeResultInput[];
      receiptId: string | null;
      idempotencyKey: string;
    },
  ) {
    const actor = await this.requireManager(userId, communityId);
    const batch = await this.repositories.purchaseBatches.findById(
      communityId,
      purchaseBatchId,
    );
    if (!batch)
      throw new ApiError(404, 'PURCHASE_BATCH_NOT_FOUND', '找不到此採購批次');
    const canonicalPayload = canonicalizeFinalizePayload(
      input.results,
      input.receiptId,
    );
    const existing =
      await this.repositories.purchaseBatches.findFinalization(purchaseBatchId);
    if (existing) {
      if (
        existing.idempotency_key === input.idempotencyKey &&
        existing.canonical_payload === canonicalPayload
      )
        return { finalized: false, purchaseBatch: await this.detail(communityId, purchaseBatchId) };
      throw new ApiError(
        409,
        existing.idempotency_key === input.idempotencyKey
          ? 'IDEMPOTENCY_CONFLICT'
          : 'PURCHASE_BATCH_FINALIZE_CONFLICT',
        '此採購批次已有不同的結算結果',
      );
    }
    if (batch.status !== 'purchasing')
      throw new ApiError(409, 'PURCHASE_BATCH_NOT_PURCHASING', '採購批次尚未開始採購');
    const groups = await this.repositories.purchaseBatches.listGroups(purchaseBatchId);
    const expectedIds = groups.map((group) => String(group.id)).sort();
    const actualIds = input.results.map((result) => result.groupingId).sort();
    if (
      new Set(actualIds).size !== actualIds.length ||
      expectedIds.length !== actualIds.length ||
      expectedIds.some((id, index) => id !== actualIds[index])
    )
      throw new ApiError(400, 'INCOMPLETE_GROUPING_RESULTS', '必須完整提供每個集單結果且不得重複');
    if (
      input.results.some(
        (result) =>
          !Number.isInteger(result.purchasedQuantity) ||
          result.purchasedQuantity < 0 ||
          !Number.isInteger(result.actualUnitPriceMinor) ||
          result.actualUnitPriceMinor < 0,
      )
    )
      throw new ApiError(400, 'INVALID_PURCHASE_RESULT', '採購數量或價格不正確');
    if (
      input.receiptId &&
      !(await this.repositories.purchaseBatches.findReceipt(
        communityId,
        purchaseBatchId,
        input.receiptId,
      ))
    )
      throw new ApiError(404, 'RECEIPT_NOT_FOUND', '找不到此收據資料');

    const statements = [];
    const resultSummaries = [];
    let committedQuantity = 0;
    let purchasedQuantity = 0;
    let estimatedTotalMinor = 0;
    let actualTotalMinor = 0;
    for (const group of groups) {
      const result = input.results.find(
        (candidate) => candidate.groupingId === group.id,
      )!;
      const committed = Number(group.committed_quantity);
      if (result.purchasedQuantity > committed)
        throw new ApiError(409, 'PURCHASED_QUANTITY_EXCEEDS_COMMITTED', '實際採購數量不可超過需求');
      const commitments =
        await this.repositories.purchaseBatches.listCommitments(String(group.id));
      if (
        commitments.reduce(
          (total, commitment) => total + Number(commitment.quantity),
          0,
        ) !== committed
      )
        throw new Error('Purchase grouping commitment snapshot drift');
      const allocations = allocateFifo(
        commitments.map((commitment) => ({
          id: String(commitment.id),
          orderItemId: String(commitment.order_item_id),
          quantity: Number(commitment.quantity),
        })),
        result.purchasedQuantity,
        result.actualUnitPriceMinor,
      );
      const estimatedSubtotal = Number(group.estimated_amount_minor);
      statements.push(
        this.repositories.purchaseBatches.insertGroupResultStatement({
          purchaseBatchId,
          groupingId: result.groupingId,
          committedQuantity: committed,
          purchasedQuantity: result.purchasedQuantity,
          actualUnitPriceMinor: result.actualUnitPriceMinor,
          estimatedSubtotalMinor: estimatedSubtotal,
        }),
        ...allocations.map((allocation) =>
          this.repositories.purchaseBatches.insertAllocationStatement({
            commitmentId: allocation.id,
            purchaseBatchId,
            groupingId: result.groupingId,
            orderItemId: allocation.orderItemId,
            committedQuantity: allocation.quantity,
            fulfilledQuantity: allocation.fulfilledQuantity,
            shortageQuantity: allocation.shortageQuantity,
            finalAmountMinor: allocation.finalAmountMinor,
          }),
        ),
      );
      committedQuantity += committed;
      purchasedQuantity += result.purchasedQuantity;
      estimatedTotalMinor += estimatedSubtotal;
      actualTotalMinor += result.purchasedQuantity * result.actualUnitPriceMinor;
      resultSummaries.push({
        groupingId: result.groupingId,
        committedQuantity: committed,
        purchasedQuantity: result.purchasedQuantity,
        shortageQuantity: committed - result.purchasedQuantity,
        actualUnitPriceMinor: result.actualUnitPriceMinor,
      });
    }
    try {
      await this.repositories.batch([
        this.repositories.purchaseBatches.insertFinalizationStatement({
          purchaseBatchId,
          idempotencyKey: input.idempotencyKey,
          canonicalPayload,
          receiptId: input.receiptId,
          committedQuantity,
          purchasedQuantity,
          shortageQuantity: committedQuantity - purchasedQuantity,
          estimatedTotalMinor,
          actualTotalMinor,
          actorUserId: actor.id,
        }),
        ...statements,
        this.repositories.purchaseBatches.finalizeAuditStatement({
          id: `purchase-finalize-${purchaseBatchId}`,
          purchaseBatchId,
          communityId,
          actorUserId: actor.id,
          metadata: {
            event: 'PURCHASE_BATCH_FINALIZED',
            results: resultSummaries,
            committedQuantity,
            purchasedQuantity,
            shortageQuantity: committedQuantity - purchasedQuantity,
            estimatedTotalMinor,
            actualTotalMinor,
            receiptId: input.receiptId,
          },
        }),
      ]);
    } catch (error) {
      const winner =
        await this.repositories.purchaseBatches.findFinalization(purchaseBatchId);
      if (winner) {
        if (
          winner.idempotency_key === input.idempotencyKey &&
          winner.canonical_payload === canonicalPayload
        )
          return { finalized: false, purchaseBatch: await this.detail(communityId, purchaseBatchId) };
        throw new ApiError(
          409,
          winner.idempotency_key === input.idempotencyKey
            ? 'IDEMPOTENCY_CONFLICT'
            : 'PURCHASE_BATCH_FINALIZE_CONFLICT',
          '此採購批次已有不同的結算結果',
        );
      }
      throw error;
    }
    return { finalized: true, purchaseBatch: await this.detail(communityId, purchaseBatchId) };
  }
}
