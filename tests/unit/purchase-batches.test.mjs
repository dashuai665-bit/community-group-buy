import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateEstimatedPurchaseTotals,
  canStartPurchasing,
  validateGroupingSelection,
} from '../../domain/purchase-batches.ts';

test('purchase batch only allows ready to purchasing', () => {
  assert.equal(canStartPurchasing('ready'), true);
  assert.equal(canStartPurchasing('purchasing'), false);
});

test('purchase batch selection rejects empty and duplicate grouping ids', () => {
  assert.throws(() => validateGroupingSelection([]), /EMPTY/);
  assert.throws(() => validateGroupingSelection(['g1', 'g1']), /DUPLICATE/);
  assert.deepEqual(validateGroupingSelection(['g1', 'g2']), ['g1', 'g2']);
});

test('estimated totals use immutable selected group demand', () => {
  assert.deepEqual(
    calculateEstimatedPurchaseTotals([
      { quantity: 30, estimatedAmountMinor: 3000 },
      { quantity: 20, estimatedAmountMinor: 4200 },
    ]),
    { groupCount: 2, totalQuantity: 50, estimatedTotalMinor: 7200 },
  );
});
