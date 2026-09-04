import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveFulfillment, requirePayableFulfillment } from '../../domain/fulfillment.ts';

const facts = (values = {}) => ({ orderedQuantity: 10, finalizedQuantity: 10, fulfilledQuantity: 6, finalPayableMinor: 600, ...values });

test('fulfillment requires every order item quantity to be finalized', () => {
  assert.equal(deriveFulfillment(facts({ finalizedQuantity: 9 })).completionState, 'procurement_pending');
  assert.equal(requirePayableFulfillment(facts({ finalizedQuantity: 9 })), 'PROCUREMENT_NOT_FINALIZED');
});

test('zero fulfillment resolves without payment or pickup', () => {
  const result = deriveFulfillment(facts({ fulfilledQuantity: 0, finalPayableMinor: 0 }));
  assert.equal(result.requiresPickup, false);
  assert.equal(result.completionState, 'no_pickup_required');
});

test('payment and handover remain separate completion facts', () => {
  assert.equal(deriveFulfillment(facts()).completionState, 'ready_for_payment');
  assert.equal(deriveFulfillment(facts({ paymentStatus: 'paid' })).completionState, 'paid_pending_pickup');
  assert.equal(deriveFulfillment(facts({ paymentStatus: 'paid', pickupStatus: 'handed_over' })).completionState, 'completed');
});

test('multi-item totals and 31 split use persisted aggregate facts', () => {
  assert.equal(deriveFulfillment(facts({ orderedQuantity: 31, finalizedQuantity: 30 })).procurementResolved, false);
  assert.equal(deriveFulfillment(facts({ orderedQuantity: 31, finalizedQuantity: 31, fulfilledQuantity: 30, finalPayableMinor: 3000 })).completionState, 'ready_for_payment');
});
