import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addOperationsMetrics,
  emptyOperationsMetrics,
} from '../../domain/admin-operations.ts';
test('admin metrics safely aggregate community summaries', () => {
  let total = emptyOperationsMetrics();
  total = addOperationsMetrics(total, {
    collecting: 2,
    grouped_ready: 1,
    pending_purchase: 1,
    pending_pickup: 0,
    unfinished_orders: 3,
  });
  total = addOperationsMetrics(total, {
    collecting: 1,
    grouped_ready: 0,
    pending_purchase: 0,
    pending_pickup: 2,
    unfinished_orders: 2,
  });
  assert.deepEqual(total, {
    collecting: 3,
    groupedReady: 1,
    pendingPurchase: 1,
    pendingPickup: 2,
    unfinishedOrders: 5,
  });
});
test('admin metrics treat empty aggregate values as zero', () =>
  assert.deepEqual(
    addOperationsMetrics(emptyOperationsMetrics(), null),
    emptyOperationsMetrics(),
  ));
