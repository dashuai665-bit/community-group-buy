import assert from 'node:assert/strict';
import test from 'node:test';
import { Repositories } from '../../server/repositories/index.ts';
import { GroupBuyBatchService } from '../../server/services/catalog.ts';
import { createPhase4Database, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4Database();
  seed(db, `INSERT INTO users(id) VALUES ('u1'),('u2'); INSERT INTO user_profiles(user_id) VALUES ('u1'),('u2');
    INSERT INTO communities(id,name,slug) VALUES ('A','A','a');
    INSERT INTO community_members(id,user_id,community_id) VALUES ('m1','u1','A'),('m2','u2','A');
    INSERT INTO products(id,name,source_type,unit_label) VALUES ('p','米','manual','包');
    INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order) VALUES ('o','A','p',100,30,1);`);
  const repositories = new Repositories({ db });
  return { db, repositories, service: new GroupBuyBatchService(repositories) };
}

test('two simultaneous threshold-crossing commits 不 overcount 或 duplicate sequence', async () => {
  const { db, repositories, service } = await setup();
  await service.commitQuantity('u1', 'A', 'o', 29, 'initial');
  await Promise.all([service.commitQuantity('u1', 'A', 'o', 1, 'race-1'), service.commitQuantity('u2', 'A', 'o', 1, 'race-2')]);
  const rows = await repositories.batches.listForOffering('o');
  assert.deepEqual(rows.map(({ sequence_number, committed_quantity, status }) => [sequence_number, committed_quantity, status]), [[1,30,'formed'],[2,1,'open']]);
  assert.equal(new Set(rows.map(({ sequence_number }) => sequence_number)).size, rows.length);
  db.close();
});

test('simultaneous multi-batch overflow 保留所有數量', async () => {
  const { db, repositories, service } = await setup();
  await Promise.all([service.commitQuantity('u1', 'A', 'o', 70, 'many-1'), service.commitQuantity('u2', 'A', 'o', 20, 'many-2')]);
  const rows = await repositories.batches.listForOffering('o');
  assert.deepEqual(rows.map(({ committed_quantity, status }) => [committed_quantity, status]), [[30,'formed'],[30,'formed'],[30,'formed']]);
  db.close();
});
