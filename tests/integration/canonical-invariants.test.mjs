// SQL-only protections exercised against the standalone canonical schema.
// Cases adapted from schema.test.mjs; no application services or historical chain imported.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionBaselineDatabase as createMigratedDatabase } from '../helpers/canonical-schema.mjs';

function seedUserAndCommunities(database) {
  database.prepare("INSERT INTO users (id) VALUES ('user-1')").run();
  database.prepare(
    "INSERT INTO communities (id, name, slug) VALUES ('A', 'A 社區', 'a'), ('B', 'B 社區', 'b'), ('C', 'C 社區', 'c')",
  ).run();
}

test('Phase 6F audit log 是 append-only', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  database.prepare("INSERT INTO audit_logs(id,actor_user_id,community_id,action_type,target_type,target_id) VALUES('audit-1','user-1','A','community_join','community','A')").run();
  assert.throws(() => database.prepare("UPDATE audit_logs SET target_id='B' WHERE id='audit-1'").run(), /AUDIT_LOG_IMMUTABLE/);
  assert.throws(() => database.prepare("DELETE FROM audit_logs WHERE id='audit-1'").run(), /AUDIT_LOG_IMMUTABLE/);
  assert.equal(database.prepare("SELECT target_id FROM audit_logs WHERE id='audit-1'").get().target_id, 'A');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
});


test('Phase 6C purchase batch constraints、immutable membership 與 rollback 正確', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  database.prepare("INSERT INTO user_profiles(user_id)VALUES('user-1')").run();
  database.prepare("INSERT INTO products(id,name,source_type,unit_label)VALUES('p','米','manual','包')").run();
  database.prepare("INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('oa','A','p',100,30,1),('ob','B','p',100,30,1)").run();
  database.prepare("INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity)VALUES('g','oa',1,'formed',30,30),('g2','oa',2,'formed',30,30),('open','oa',3,'open',30,1),('other','ob',1,'formed',30,30)").run();
  const insertBatch = database.prepare("INSERT INTO purchase_batches(id,community_id,idempotency_key,created_by_user_id)VALUES(?,?,?,?)");
  insertBatch.run('pb','A','same-key','user-1');
  assert.throws(() => insertBatch.run('duplicate','A','same-key','user-1'), /UNIQUE/);
  assert.throws(() => database.prepare("UPDATE purchase_batches SET status='completed'").run(), /CHECK/);
  assert.equal(database.prepare("SELECT pk FROM pragma_table_info('purchase_batch_groups') WHERE name='group_buy_batch_id'").get().pk, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM pragma_foreign_key_list('purchase_batch_groups')").get().count, 2);

  database.prepare("INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('pb','g')").run();
  assert.equal(database.prepare("SELECT status FROM group_buy_batches WHERE id='g'").get().status, 'locked');
  assert.throws(() => database.prepare("INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('pb','open')").run(), /INELIGIBLE/);
  assert.throws(() => database.prepare("INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('pb','other')").run(), /INELIGIBLE/);
  assert.throws(() => database.prepare("UPDATE purchase_batch_groups SET purchase_batch_id='other' WHERE group_buy_batch_id='g'").run(), /PURCHASE_BATCH_MEMBERSHIP_IMMUTABLE/);
  assert.throws(() => database.prepare("DELETE FROM purchase_batch_groups WHERE group_buy_batch_id='g'").run(), /PURCHASE_BATCH_MEMBERSHIP_IMMUTABLE/);
  assert.equal(database.prepare("SELECT purchase_batch_id FROM purchase_batch_groups WHERE group_buy_batch_id='g'").get().purchase_batch_id, 'pb');

  database.exec('BEGIN');
  try {
    insertBatch.run('rollback','A','rollback-key','user-1');
    database.prepare("INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('rollback','g2')").run();
    database.prepare("INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('rollback','open')").run();
    assert.fail('second membership must be rejected');
  } catch (error) {
    database.exec('ROLLBACK');
    assert.match(String(error), /INELIGIBLE/);
  }
  assert.equal(database.prepare("SELECT COUNT(*) count FROM purchase_batches WHERE id='rollback'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM purchase_batch_groups WHERE group_buy_batch_id='g2'").get().count, 0);
  assert.equal(database.prepare("SELECT status FROM group_buy_batches WHERE id='g2'").get().status, 'formed');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
});


test('Phase 6D finalized records immutable 且 allocation relationships 受 DB 保護', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  database.exec("INSERT INTO user_profiles(user_id)VALUES('user-1');INSERT INTO products(id,name,source_type,unit_label)VALUES('p','米','manual','包');INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('o','A','p',100,30,1);INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity)VALUES('g1','o',1,'formed',30,1),('g2','o',2,'formed',30,1);INSERT INTO orders(id,user_id,community_id,status,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot)VALUES('order1','user-1','A','formed',100,'order1-key','住戶','0900'),('order2','user-1','A','formed',100,'order2-key','住戶','0900');INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor)VALUES('item1','order1','o','p','米','包',100,1,100),('item2','order2','o','p','米','包',100,1,100);INSERT INTO batch_commitments(id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)VALUES('commit1','request1','g1',1,'order_item','item1','item1','active'),('commit2','request2','g2',1,'order_item','item2','item2','active');INSERT INTO purchase_batches(id,community_id,status,idempotency_key,created_by_user_id)VALUES('pb1','A','purchasing','pb1-key','user-1'),('pb2','A','purchasing','pb2-key','user-1');INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('pb1','g1'),('pb2','g2');INSERT INTO purchase_batch_finalizations(purchase_batch_id,idempotency_key,canonical_payload,committed_quantity,purchased_quantity,shortage_quantity,estimated_total_minor,actual_total_minor,finalized_by_user_id)VALUES('pb1','final1','{}',1,1,0,100,100,'user-1'),('pb2','final2','{}',1,1,0,100,100,'user-1');INSERT INTO purchase_group_results(group_buy_batch_id,purchase_batch_id,committed_quantity_snapshot,purchased_quantity,shortage_quantity,actual_unit_price_minor,estimated_subtotal_minor,actual_subtotal_minor)VALUES('g1','pb1',1,1,0,100,100,100),('g2','pb2',1,1,0,100,100,100)");

  const allocation = database.prepare("INSERT INTO purchase_allocations(batch_commitment_id,purchase_batch_id,group_buy_batch_id,order_item_id,committed_quantity_snapshot,fulfilled_quantity,shortage_quantity,final_amount_minor)VALUES(?,?,?,?,1,1,0,100)");
  assert.throws(() => allocation.run('commit1','pb2','g1','item1'), /PURCHASE_ALLOCATION_RELATION_INVALID/);
  assert.throws(() => allocation.run('commit2','pb1','g1','item2'), /PURCHASE_ALLOCATION_RELATION_INVALID/);
  assert.throws(() => allocation.run('commit1','pb1','g1','item2'), /PURCHASE_ALLOCATION_RELATION_INVALID/);
  allocation.run('commit1','pb1','g1','item1');

  assert.throws(() => database.prepare("UPDATE purchase_batch_finalizations SET actual_total_minor=0 WHERE purchase_batch_id='pb1'").run(), /PURCHASE_FINALIZATION_IMMUTABLE/);
  assert.throws(() => database.prepare("DELETE FROM purchase_batch_finalizations WHERE purchase_batch_id='pb1'").run(), /PURCHASE_FINALIZATION_IMMUTABLE/);
  assert.throws(() => database.prepare("UPDATE purchase_group_results SET actual_unit_price_minor=0 WHERE group_buy_batch_id='g1'").run(), /PURCHASE_RESULT_IMMUTABLE/);
  assert.throws(() => database.prepare("DELETE FROM purchase_group_results WHERE group_buy_batch_id='g1'").run(), /PURCHASE_RESULT_IMMUTABLE/);
  assert.throws(() => database.prepare("UPDATE purchase_allocations SET fulfilled_quantity=0 WHERE batch_commitment_id='commit1'").run(), /PURCHASE_ALLOCATION_IMMUTABLE/);
  assert.throws(() => database.prepare("DELETE FROM purchase_allocations WHERE batch_commitment_id='commit1'").run(), /PURCHASE_ALLOCATION_IMMUTABLE/);
  assert.equal(database.prepare("SELECT actual_total_minor FROM purchase_batch_finalizations WHERE purchase_batch_id='pb1'").get().actual_total_minor, 100);
  const result = database.prepare("SELECT purchased_quantity,actual_unit_price_minor FROM purchase_group_results WHERE group_buy_batch_id='g1'").get();
  assert.equal(result.purchased_quantity, 1);
  assert.equal(result.actual_unit_price_minor, 100);
  const savedAllocation = database.prepare("SELECT fulfilled_quantity,final_amount_minor FROM purchase_allocations WHERE batch_commitment_id='commit1'").get();
  assert.equal(savedAllocation.fulfilled_quantity, 1);
  assert.equal(savedAllocation.final_amount_minor, 100);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
});


test('Phase 6E cash payment 與 pickup operational constraints 正確', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  database.exec("INSERT INTO user_profiles(user_id)VALUES('user-1');INSERT INTO products(id,name,source_type,unit_label)VALUES('product','米','manual','包');INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('offering','A','product',100,10,1);INSERT INTO orders(id,user_id,community_id,status,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot)VALUES('o','user-1','A','formed',1000,'order-key','住戶','0900'),('zero','user-1','A','formed',1000,'zero-key','住戶','0900'),('pending','user-1','A','formed',1000,'pending-key','住戶','0900');INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor)VALUES('item','o','offering','product','米','包',100,10,1000),('zero-item','zero','offering','product','米','包',100,10,1000),('pending-item','pending','offering','product','米','包',100,10,1000);INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity)VALUES('group1','offering',1,'formed',10,10),('group0','offering',2,'formed',10,10);INSERT INTO batch_commitments(id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)VALUES('commit','request','group1',10,'order_item','item','item','active'),('zero-commit','zero-request','group0',10,'order_item','zero-item','zero-item','active');INSERT INTO purchase_batches(id,community_id,status,idempotency_key,created_by_user_id)VALUES('pb','A','purchasing','pb-key','user-1'),('pb0','A','purchasing','pb0-key','user-1');INSERT INTO purchase_batch_groups(purchase_batch_id,group_buy_batch_id)VALUES('pb','group1'),('pb0','group0');INSERT INTO purchase_batch_finalizations(purchase_batch_id,idempotency_key,canonical_payload,committed_quantity,purchased_quantity,shortage_quantity,estimated_total_minor,actual_total_minor,finalized_by_user_id)VALUES('pb','final-key','{}',10,6,4,1000,600,'user-1'),('pb0','final0-key','{}',10,0,10,1000,0,'user-1');INSERT INTO purchase_group_results(group_buy_batch_id,purchase_batch_id,committed_quantity_snapshot,purchased_quantity,shortage_quantity,actual_unit_price_minor,estimated_subtotal_minor,actual_subtotal_minor)VALUES('group1','pb',10,6,4,100,1000,600),('group0','pb0',10,0,10,100,1000,0);INSERT INTO purchase_allocations(batch_commitment_id,purchase_batch_id,group_buy_batch_id,order_item_id,committed_quantity_snapshot,fulfilled_quantity,shortage_quantity,final_amount_minor)VALUES('commit','pb','group1','item',10,6,4,600),('zero-commit','pb0','group0','zero-item',10,0,10,0)");
  const payment = database.prepare("INSERT INTO cash_payments(order_id,community_id,amount_minor,method,status,confirmed_by_user_id)VALUES(?,?,?,?,?,?)");
  assert.throws(() => payment.run('o','B',100,'cash','paid','user-1'), /PAYMENT_ORDER_COMMUNITY_INVALID/);
  assert.throws(() => payment.run('o','A',0,'cash','paid','user-1'), /PAYMENT_AMOUNT_MISMATCH|CHECK/);
  assert.throws(() => payment.run('o','A',600,'card','paid','user-1'), /CHECK/);
  assert.throws(() => payment.run('o','A',1,'cash','paid','user-1'), /PAYMENT_AMOUNT_MISMATCH/);
  assert.throws(() => payment.run('pending','A',1000,'cash','paid','user-1'), /PAYMENT_PROCUREMENT_NOT_FINALIZED/);
  assert.throws(() => payment.run('zero','A',1,'cash','paid','user-1'), /NO_PICKUP_REQUIRED/);
  assert.throws(() => database.prepare("INSERT INTO pickup_records(id,order_id,community_id,status,picked_up_at,handed_over_by_user_id)VALUES('direct-unpaid','o','A','picked_up',CURRENT_TIMESTAMP,'user-1')").run(), /PAYMENT_REQUIRED_BEFORE_HANDOVER/);
  payment.run('o','A',600,'cash','paid','user-1');
  assert.throws(() => payment.run('o','A',600,'cash','paid','user-1'), /UNIQUE/);
  assert.throws(() => database.prepare("UPDATE cash_payments SET amount_minor=1 WHERE order_id='o'").run(), /CASH_PAYMENT_IMMUTABLE/);
  assert.throws(() => database.prepare("INSERT INTO pickup_records(id,order_id,community_id,status)VALUES('bad','o','B','ready')").run(), /PICKUP_ORDER_COMMUNITY_INVALID/);
  assert.throws(() => database.prepare("INSERT INTO pickup_records(id,order_id,community_id,status,picked_up_at)VALUES('direct-no-actor','o','A','picked_up',CURRENT_TIMESTAMP)").run(), /HANDOVER_ACTOR_TIME_REQUIRED/);
  assert.throws(() => database.prepare("INSERT INTO pickup_records(id,order_id,community_id,status,handed_over_by_user_id)VALUES('direct-no-time','o','A','picked_up','user-1')").run(), /HANDOVER_ACTOR_TIME_REQUIRED/);
  database.prepare("INSERT INTO pickup_records(id,order_id,community_id,status)VALUES('pending-pickup','pending','A','ready')").run();
  assert.throws(() => database.prepare("UPDATE pickup_records SET status='picked_up',picked_up_at=CURRENT_TIMESTAMP,handed_over_by_user_id='user-1' WHERE id='pending-pickup'").run(), /PAYMENT_REQUIRED_BEFORE_HANDOVER/);
  database.prepare("INSERT INTO pickup_records(id,order_id,community_id,status,pickup_location_snapshot,pickup_window_snapshot)VALUES('p','o','A','ready','A社區','週六')").run();
  assert.throws(() => database.prepare("UPDATE pickup_records SET status='picked_up',picked_up_at=CURRENT_TIMESTAMP WHERE id='p'").run(), /HANDOVER_ACTOR_TIME_REQUIRED/);
  database.prepare("UPDATE pickup_records SET status='picked_up',picked_up_at=CURRENT_TIMESTAMP,handed_over_by_user_id='user-1' WHERE id='p'").run();
  assert.throws(() => database.prepare("UPDATE pickup_records SET status='ready' WHERE id='p'").run(), /HANDOVER_IMMUTABLE/);
  assert.throws(() => database.prepare("UPDATE pickup_records SET handed_over_by_user_id='user-1' WHERE id='p'").run(), /HANDOVER_IMMUTABLE/);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
});
