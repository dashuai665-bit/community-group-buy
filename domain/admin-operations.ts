export type OperationsMetrics = {
  collecting: number;
  groupedReady: number;
  pendingPurchase: number;
  pendingPickup: number;
  unfinishedOrders: number;
};
export function emptyOperationsMetrics(): OperationsMetrics {
  return {
    collecting: 0,
    groupedReady: 0,
    pendingPurchase: 0,
    pendingPickup: 0,
    unfinishedOrders: 0,
  };
}
export function addOperationsMetrics(
  total: OperationsMetrics,
  row: {
    collecting?: number;
    grouped_ready?: number;
    pending_purchase?: number;
    pending_pickup?: number;
    unfinished_orders?: number;
  } | null,
): OperationsMetrics {
  return {
    collecting: total.collecting + Number(row?.collecting ?? 0),
    groupedReady: total.groupedReady + Number(row?.grouped_ready ?? 0),
    pendingPurchase: total.pendingPurchase + Number(row?.pending_purchase ?? 0),
    pendingPickup: total.pendingPickup + Number(row?.pending_pickup ?? 0),
    unfinishedOrders:
      total.unfinishedOrders + Number(row?.unfinished_orders ?? 0),
  };
}
