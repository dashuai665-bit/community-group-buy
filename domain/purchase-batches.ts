export type PurchaseBatchStatus = 'ready' | 'purchasing';

export function validateGroupingSelection(groupingIds: string[]): string[] {
  if (groupingIds.length === 0) throw new Error('EMPTY_GROUPING_SELECTION');
  if (new Set(groupingIds).size !== groupingIds.length)
    throw new Error('DUPLICATE_GROUPING_SELECTION');
  return groupingIds;
}

export function canStartPurchasing(status: PurchaseBatchStatus): boolean {
  return status === 'ready';
}

export function calculateEstimatedPurchaseTotals(
  groups: Array<{ quantity: number; estimatedAmountMinor: number }>,
) {
  return groups.reduce(
    (total, group) => ({
      groupCount: total.groupCount + 1,
      totalQuantity: total.totalQuantity + group.quantity,
      estimatedTotalMinor:
        total.estimatedTotalMinor + group.estimatedAmountMinor,
    }),
    { groupCount: 0, totalQuantity: 0, estimatedTotalMinor: 0 },
  );
}
