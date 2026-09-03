import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGroupingConditionKey,
  eligibleCollectingQuantity,
  isAutomaticFormationReady,
} from '../../domain/grouping.ts';

test('grouping condition key is stable but is not a grouping instance id', () => {
  assert.equal(
    createGroupingConditionKey({
      communityId: 'community-a',
      offeringId: 'offering-a',
    }),
    createGroupingConditionKey({
      communityId: 'community-a',
      offeringId: 'offering-a',
    }),
  );
});

test('grouping key changes across communities and offering specifications', () => {
  assert.notEqual(
    createGroupingConditionKey({
      communityId: 'community-a',
      offeringId: 'offering-a',
    }),
    createGroupingConditionKey({
      communityId: 'community-b',
      offeringId: 'offering-a',
    }),
  );
  assert.notEqual(
    createGroupingConditionKey({
      communityId: 'community-a',
      offeringId: 'offering-a',
    }),
    createGroupingConditionKey({
      communityId: 'community-a',
      offeringId: 'offering-b',
    }),
  );
});

test('automatic formation requires reaching the snapshotted threshold', () => {
  assert.equal(isAutomaticFormationReady(29, 30), false);
  assert.equal(isAutomaticFormationReady(30, 30), true);
  assert.equal(isAutomaticFormationReady(31, 30), true);
  assert.equal(isAutomaticFormationReady(0, 0), false);
});

test('cancelled commitments never contribute to collecting quantity', () => {
  assert.equal(
    eligibleCollectingQuantity([
      { quantity: 12, status: 'active' },
      { quantity: 18, status: 'cancelled' },
      { quantity: 3, status: 'active' },
    ]),
    15,
  );
});

test('grouping condition identity rejects missing scope', () => {
  assert.throws(() =>
    createGroupingConditionKey({ communityId: '', offeringId: 'a' }),
  );
  assert.throws(() =>
    createGroupingConditionKey({ communityId: 'a', offeringId: ' ' }),
  );
});
