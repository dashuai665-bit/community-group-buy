export type FinalizeResultInput = {
  groupingId: string;
  purchasedQuantity: number;
  actualUnitPriceMinor: number;
};

export type CommitmentDemand = {
  id: string;
  orderItemId: string;
  quantity: number;
};

export function canonicalizeFinalizePayload(
  results: FinalizeResultInput[],
  receiptId: string | null,
) {
  return JSON.stringify({
    receiptId,
    results: [...results].sort((a, b) =>
      a.groupingId.localeCompare(b.groupingId),
    ),
  });
}

export function allocateFifo(
  commitments: CommitmentDemand[],
  purchasedQuantity: number,
  actualUnitPriceMinor: number,
) {
  let remaining = purchasedQuantity;
  return commitments.map((commitment) => {
    const fulfilledQuantity = Math.min(commitment.quantity, remaining);
    remaining -= fulfilledQuantity;
    return {
      ...commitment,
      fulfilledQuantity,
      shortageQuantity: commitment.quantity - fulfilledQuantity,
      finalAmountMinor: fulfilledQuantity * actualUnitPriceMinor,
    };
  });
}

export function deriveProcurementState(
  orderedQuantity: number,
  finalizedQuantity: number,
) {
  if (finalizedQuantity === 0) return 'pending';
  if (finalizedQuantity < orderedQuantity) return 'partially_finalized';
  return 'finalized';
}
