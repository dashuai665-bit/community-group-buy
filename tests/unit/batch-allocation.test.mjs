import assert from 'node:assert/strict';
import test from 'node:test';
import { planBatchAllocation } from '../../domain/batch-allocation.ts';

test('26 + 10 拆成 formed 30 與 open 6', () => assert.deepEqual(planBatchAllocation(26, 30, 10), [{ quantity: 30, status: 'formed' }, { quantity: 6, status: 'open' }]));
test('70 拆成兩個 formed 與一個 open', () => assert.deepEqual(planBatchAllocation(0, 30, 70), [{ quantity: 30, status: 'formed' }, { quantity: 30, status: 'formed' }, { quantity: 10, status: 'open' }]));
test('未達門檻維持 open', () => assert.deepEqual(planBatchAllocation(0, 30, 26), [{ quantity: 26, status: 'open' }]));
test('拒絕非正整數 threshold 與 quantity', () => {
  assert.throws(() => planBatchAllocation(0, 0, 1), RangeError);
  assert.throws(() => planBatchAllocation(0, 30, -1), RangeError);
  assert.throws(() => planBatchAllocation(0, 30, 1.5), RangeError);
});
