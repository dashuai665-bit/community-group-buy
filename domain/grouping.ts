/** Identifies shared grouping conditions, not a unique grouping instance. */
export function createGroupingConditionKey(input: {
  communityId: string;
  offeringId: string;
}): string {
  const communityId = input.communityId.trim();
  const offeringId = input.offeringId.trim();
  if (!communityId || !offeringId)
    throw new Error('grouping condition identity is required');
  return `${communityId}:${offeringId}`;
}

export function isAutomaticFormationReady(
  committedQuantity: number,
  thresholdQuantity: number,
): boolean {
  return thresholdQuantity > 0 && committedQuantity >= thresholdQuantity;
}

export function eligibleCollectingQuantity(
  commitments: Array<{ quantity: number; status: string }>,
): number {
  return commitments.reduce(
    (total, commitment) =>
      commitment.status === 'active' ? total + commitment.quantity : total,
    0,
  );
}
