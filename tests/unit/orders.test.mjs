import assert from 'node:assert/strict';
import test from 'node:test';
import { canCancelOrder,deriveFormationStatus } from '../../domain/orders.ts';
test('order status 依 item formation 推導',()=>{assert.equal(deriveFormationStatus([{allCommitmentsFormed:false}]),'submitted');assert.equal(deriveFormationStatus([{allCommitmentsFormed:true},{allCommitmentsFormed:false}]),'partially_formed');assert.equal(deriveFormationStatus([{allCommitmentsFormed:true}]),'formed');});
test('user cancellation policy',()=>{assert.equal(canCancelOrder('submitted'),true);assert.equal(canCancelOrder('formed'),false);assert.equal(canCancelOrder('ready_for_pickup'),false);assert.equal(canCancelOrder('completed'),false);});
test('admin 可取消未鎖定 formed，但 locked boundary 禁止',()=>{assert.equal(canCancelOrder('formed',true),true);assert.equal(canCancelOrder('formed',true,true),false);});
