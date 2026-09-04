import assert from 'node:assert/strict';
import test from 'node:test';
import { Repositories } from '../../server/repositories/index.ts';
import { PurchaseBatchService } from '../../server/services/purchase-batches.ts';
import { createPhase4BDatabase, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4BDatabase();
  seed(db, `INSERT INTO users(id)VALUES('a'),('u');INSERT INTO user_profiles(user_id,display_name)VALUES('a','管理員'),('u','住戶');INSERT INTO communities(id,name,slug)VALUES('A','A','a');INSERT INTO community_members(id,user_id,community_id,role)VALUES('ma','a','A','community_admin'),('mu','u','A','resident');INSERT INTO products(id,name,source_type,unit_label)VALUES('p','米','manual','包');INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('o','A','p',100,30,1);INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity,formed_at)VALUES('G1','o',1,'formed',30,30,CURRENT_TIMESTAMP),('G2','o',2,'formed',30,30,CURRENT_TIMESTAMP);INSERT INTO orders(id,user_id,community_id,status,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot,created_at)VALUES('O1','u','A','formed',3000,'o1','住戶','0900','2026-01-01'),('O2','u','A','formed',3000,'o2','住戶','0900','2026-01-02');INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor)VALUES('I1','O1','o','p','米','包',100,30,3000),('I2','O2','o','p','米','包',100,30,3000);INSERT INTO batch_commitments(id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)VALUES('C1','r1','G1',30,'order_item','I1','I1','active'),('C2','r2','G2',30,'order_item','I2','I2','active');`);
  const repositories = new Repositories({ db });
  const service = new PurchaseBatchService(repositories);
  return { db, repositories, service };
}

async function setupSplit() {
  const db = await createPhase4BDatabase();
  seed(db, `INSERT INTO users(id)VALUES('a'),('u');INSERT INTO user_profiles(user_id,display_name)VALUES('a','管理員'),('u','住戶');INSERT INTO communities(id,name,slug)VALUES('A','A','a');INSERT INTO community_members(id,user_id,community_id,role)VALUES('ma','a','A','community_admin'),('mu','u','A','resident');INSERT INTO products(id,name,source_type,unit_label)VALUES('p','米','manual','包');INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order)VALUES('o','A','p',100,30,1);INSERT INTO group_buy_batches(id,offering_id,sequence_number,status,threshold_quantity,committed_quantity,formed_at)VALUES('G1','o',1,'formed',30,30,CURRENT_TIMESTAMP),('G2','o',2,'formed',30,1,CURRENT_TIMESTAMP);INSERT INTO orders(id,user_id,community_id,status,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot)VALUES('O','u','A','formed',3100,'order-key','住戶','0900');INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor)VALUES('I','O','o','p','米','包',100,31,3100);INSERT INTO batch_commitments(id,request_id,batch_id,quantity,source_type,source_reference,order_item_id,status)VALUES('C1','r1','G1',30,'order_item','I','I','active'),('C2','r2','G2',1,'order_item','I','I','active');`);
  const repositories = new Repositories({ db });
  return { db, repositories, service: new PurchaseBatchService(repositories) };
}

async function purchasing(c, groupingIds, key) {
  const made = await c.service.create('a', 'A', { groupingIds, idempotencyKey: key });
  await c.service.start('a', 'A', made.purchaseBatch.id);
  return made.purchaseBatch.id;
}

const input = (quantity, key = 'final-key-01') => ({
  idempotencyKey: key,
  receiptId: null,
  results: [{ groupingId: 'G1', purchasedQuantity: quantity, actualUnitPriceMinor: 100 }],
});

test('same finalize request concurrently creates one logical result and audit', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1'], 'create-key-01');
    const [a, b] = await Promise.all([c.service.finalize('a', 'A', id, input(20)), c.service.finalize('a', 'A', id, input(20))]);
    assert.equal(a.purchaseBatch.finalization.actualTotalMinor, 2000);
    assert.equal(b.purchaseBatch.finalization.actualTotalMinor, 2000);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_allocations').get().count, 1);
    assert.equal(c.db.database.prepare("SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_FINALIZED%'").get().count, 1);
  } finally { c.db.close(); }
});

test('different concurrent finalize payload has one winner and conflict loser', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1'], 'create-key-01');
    const outcomes = await Promise.allSettled([c.service.finalize('a', 'A', id, input(20)), c.service.finalize('a', 'A', id, input(10))]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find((x) => x.status === 'rejected').reason.status, 409);
    const result = c.db.database.prepare('SELECT purchased_quantity FROM purchase_group_results').get();
    assert.ok([10, 20].includes(result.purchased_quantity));
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_batch_finalizations').get().count, 1);
  } finally { c.db.close(); }
});

test('same idempotency key with different finalize payload is an idempotency conflict', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1'], 'create-key-01');
    await c.service.finalize('a', 'A', id, input(20));
    await assert.rejects(c.service.finalize('a', 'A', id, input(10)), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
  } finally { c.db.close(); }
});

test('different Purchase Batches finalize independently', async () => {
  const c = await setup();
  try {
    const a = await purchasing(c, ['G1'], 'create-key-01');
    const b = await purchasing(c, ['G2'], 'create-key-02');
    await Promise.all([
      c.service.finalize('a', 'A', a, input(30, 'final-key-01')),
      c.service.finalize('a', 'A', b, { ...input(30, 'final-key-02'), results: [{ groupingId: 'G2', purchasedQuantity: 30, actualUnitPriceMinor: 110 }] }),
    ]);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_batch_finalizations').get().count, 2);
  } finally { c.db.close(); }
});

test('retry after finalized preserves timestamp and a single audit', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1'], 'create-key-01');
    const first = await c.service.finalize('a', 'A', id, input(30));
    const retry = await c.service.finalize('a', 'A', id, input(30));
    assert.equal(first.purchaseBatch.finalization.finalizedAt, retry.purchaseBatch.finalization.finalizedAt);
    assert.equal(c.db.database.prepare("SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_FINALIZED%'").get().count, 1);
  } finally { c.db.close(); }
});

test('invalid second grouping causes complete rollback', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1', 'G2'], 'create-key-01');
    await assert.rejects(c.service.finalize('a', 'A', id, {
      idempotencyKey: 'final-key-01', receiptId: null,
      results: [{ groupingId: 'G1', purchasedQuantity: 30, actualUnitPriceMinor: 100 }, { groupingId: 'G2', purchasedQuantity: 31, actualUnitPriceMinor: 100 }],
    }), (error) => error.status === 409);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_batch_finalizations').get().count, 0);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_group_results').get().count, 0);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_allocations').get().count, 0);
  } finally { c.db.close(); }
});

test('31 split aggregates only finalized batches and preserves each actual price', async () => {
  const c = await setupSplit();
  try {
    const first = await purchasing(c, ['G1'], 'create-key-01');
    await c.service.finalize('a', 'A', first, input(30, 'final-key-01'));
    let rows = await c.repositories.purchaseBatches.procurementForOrder('O');
    assert.equal(rows[0].fulfilled_quantity, 30);
    assert.equal(rows[0].finalized_quantity, 30);
    const second = await purchasing(c, ['G2'], 'create-key-02');
    await c.service.finalize('a', 'A', second, {
      idempotencyKey: 'final-key-02', receiptId: null,
      results: [{ groupingId: 'G2', purchasedQuantity: 1, actualUnitPriceMinor: 110 }],
    });
    rows = await c.repositories.purchaseBatches.procurementForOrder('O');
    assert.equal(rows[0].fulfilled_quantity, 31);
    assert.equal(rows[0].shortage_quantity, 0);
    assert.equal(rows[0].final_payable_minor, 3110);
    assert.equal((await c.repositories.reconciliation.inspectProcurement(first)).ok, true);
    assert.equal((await c.repositories.reconciliation.inspectProcurement(second)).ok, true);
  } finally { c.db.close(); }
});

test('31 split with second grouping purchased zero ends fulfilled 30 shortage 1', async () => {
  const c = await setupSplit();
  try {
    const first = await purchasing(c, ['G1'], 'create-key-01');
    await c.service.finalize('a', 'A', first, input(30, 'final-key-01'));
    const second = await purchasing(c, ['G2'], 'create-key-02');
    await c.service.finalize('a', 'A', second, {
      idempotencyKey: 'final-key-02', receiptId: null,
      results: [{ groupingId: 'G2', purchasedQuantity: 0, actualUnitPriceMinor: 110 }],
    });
    const row = (await c.repositories.purchaseBatches.procurementForOrder('O'))[0];
    assert.equal(row.fulfilled_quantity, 30);
    assert.equal(row.shortage_quantity, 1);
  } finally { c.db.close(); }
});

test('allocation database failure rolls back finalization, results, allocations and audit', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1'], 'create-key-01');
    c.db.exec(`CREATE TRIGGER test_reject_allocation BEFORE INSERT ON purchase_allocations
      BEGIN SELECT RAISE(ABORT,'TEST_ALLOCATION_CONSTRAINT'); END`);
    await assert.rejects(c.service.finalize('a', 'A', id, input(20)), /TEST_ALLOCATION_CONSTRAINT/);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_batch_finalizations').get().count, 0);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_group_results').get().count, 0);
    assert.equal(c.db.database.prepare('SELECT COUNT(*) count FROM purchase_allocations').get().count, 0);
    assert.equal(c.db.database.prepare("SELECT COUNT(*) count FROM audit_logs WHERE metadata LIKE '%PURCHASE_BATCH_FINALIZED%'").get().count, 0);
  } finally { c.db.close(); }
});

test('procurement reconciliation detects relational allocation drift', async () => {
  const c = await setup();
  try {
    const id = await purchasing(c, ['G1'], 'create-key-01');
    await c.service.finalize('a', 'A', id, input(20));
    c.db.exec('DROP TRIGGER purchase_allocations_immutable_update');
    c.db.database.prepare("UPDATE purchase_allocations SET order_item_id='I2' WHERE batch_commitment_id='C1'").run();
    const report = await c.repositories.reconciliation.inspectProcurement(id);
    assert.equal(report.ok, false);
    assert.equal(report.relationalDrift.length, 1);
    assert.equal(report.relationalDrift[0].batch_commitment_id, 'C1');
  } finally { c.db.close(); }
});
