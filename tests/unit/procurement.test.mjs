import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateFifo,
  canonicalizeFinalizePayload,
  deriveProcurementState,
} from '../../domain/procurement.ts';

const demands = [
  { id: 'A', orderItemId: 'A', quantity: 8 },
  { id: 'B', orderItemId: 'B', quantity: 10 },
  { id: 'C', orderItemId: 'C', quantity: 12 },
];

test('FIFO allocates exact demand in stable input order', () => {
  assert.deepEqual(
    allocateFifo(demands, 20, 100).map((row) => row.fulfilledQuantity),
    [8, 10, 2],
  );
  assert.deepEqual(
    allocateFifo(demands, 20, 100).map((row) => row.shortageQuantity),
    [0, 0, 10],
  );
});

test('FIFO supports zero, full, and partial two-order purchases', () => {
  assert.deepEqual(allocateFifo(demands, 0, 100).map((x) => x.fulfilledQuantity), [0, 0, 0]);
  assert.deepEqual(allocateFifo(demands, 30, 100).map((x) => x.fulfilledQuantity), [8, 10, 12]);
  assert.deepEqual(allocateFifo([{ id: 'A', orderItemId: 'A', quantity: 20 }, { id: 'B', orderItemId: 'B', quantity: 20 }], 30, 100).map((x) => x.fulfilledQuantity), [20, 10]);
});

test('final payable uses fulfilled quantity and actual minor-unit price', () => {
  assert.deepEqual(
    allocateFifo(demands, 20, 125).map((row) => row.finalAmountMinor),
    [1000, 1250, 250],
  );
});

test('canonical finalize payload ignores grouping result order', () => {
  const a = canonicalizeFinalizePayload([
    { groupingId: 'G1', purchasedQuantity: 30, actualUnitPriceMinor: 100 },
    { groupingId: 'G2', purchasedQuantity: 1, actualUnitPriceMinor: 110 },
  ], null);
  const b = canonicalizeFinalizePayload([
    { groupingId: 'G2', purchasedQuantity: 1, actualUnitPriceMinor: 110 },
    { groupingId: 'G1', purchasedQuantity: 30, actualUnitPriceMinor: 100 },
  ], null);
  assert.equal(a, b);
  assert.notEqual(a, canonicalizeFinalizePayload([{ groupingId: 'G1', purchasedQuantity: 20, actualUnitPriceMinor: 100 }], null));
});

test('procurement state does not mark split items finalized early', () => {
  assert.equal(deriveProcurementState(31, 0), 'pending');
  assert.equal(deriveProcurementState(31, 30), 'partially_finalized');
  assert.equal(deriveProcurementState(31, 31), 'finalized');
});
