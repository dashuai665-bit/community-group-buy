export type FulfillmentFacts = {
  orderedQuantity: number;
  finalizedQuantity: number;
  fulfilledQuantity: number;
  finalPayableMinor: number;
  paymentStatus?: 'unpaid' | 'paid';
  pickupStatus?: 'pending' | 'handed_over';
};

export function deriveFulfillment(facts: FulfillmentFacts) {
  const procurementResolved =
    facts.orderedQuantity > 0 &&
    facts.finalizedQuantity === facts.orderedQuantity;
  if (!procurementResolved)
    return { procurementResolved, requiresPickup: false, completionState: 'procurement_pending' as const };
  if (facts.fulfilledQuantity === 0)
    return { procurementResolved, requiresPickup: false, completionState: 'no_pickup_required' as const };
  if (facts.paymentStatus !== 'paid')
    return { procurementResolved, requiresPickup: true, completionState: 'ready_for_payment' as const };
  if (facts.pickupStatus !== 'handed_over')
    return { procurementResolved, requiresPickup: true, completionState: 'paid_pending_pickup' as const };
  return { procurementResolved, requiresPickup: true, completionState: 'completed' as const };
}

export function requirePayableFulfillment(facts: FulfillmentFacts) {
  const fulfillment = deriveFulfillment(facts);
  if (!fulfillment.procurementResolved) return 'PROCUREMENT_NOT_FINALIZED' as const;
  if (!fulfillment.requiresPickup || facts.finalPayableMinor === 0)
    return 'NO_PICKUP_REQUIRED' as const;
  return null;
}
