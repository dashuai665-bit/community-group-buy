import assert from 'node:assert/strict';import test from 'node:test';import{formatBatchProgress,formatMoney,formatOrderStatus,remainingForBatch}from'../../lib/storefront.ts';
test('TWD minor unit 以使用者金額顯示',()=>assert.equal(formatMoney(19900),'NT$199'));
test('訂單狀態映射為繁體中文',()=>{assert.equal(formatOrderStatus('submitted'),'湊單中');assert.equal(formatOrderStatus('ready_for_pickup'),'可取貨');assert.equal(formatOrderStatus('cancelled'),'已取消');});
test('batch progress 與剩餘數量格式正確',()=>{assert.equal(formatBatchProgress(7,30),'7 / 30');assert.equal(remainingForBatch(7,30),23);assert.equal(remainingForBatch(30,30),0);});
