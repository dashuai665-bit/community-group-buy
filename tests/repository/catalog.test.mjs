import assert from 'node:assert/strict';
import test from 'node:test';
import { Repositories } from '../../server/repositories/index.ts';
import { GroupBuyBatchService, ProductWishService } from '../../server/services/catalog.ts';
import { createPhase4Database, seed } from '../helpers/sqlite-database.mjs';

async function setup() {
  const db = await createPhase4Database();
  seed(db, `INSERT INTO users(id) VALUES ('admin'),('member');
    INSERT INTO user_profiles(user_id) VALUES ('admin'),('member');
    INSERT INTO communities(id,name,slug) VALUES ('A','A 社區','a');
    INSERT INTO community_members(id,user_id,community_id,role) VALUES ('ma','admin','A','community_admin'),('mm','member','A','resident');
    INSERT INTO products(id,name,source_type,unit_label) VALUES ('p','白米','supplier','包');
    INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order) VALUES ('o','A','p',19900,30,1);`);
  return { db, repositories: new Repositories({ db }) };
}

test('product CRUD 基礎讀取與 offering unique constraint', async () => {
  const { db, repositories } = await setup();
  assert.equal((await repositories.products.findById('p')).name, '白米');
  await assert.rejects(() => repositories.batch([repositories.offerings.insertStatement({ id: 'dup', communityId: 'A', productId: 'p', priceMinor: 1, batchThreshold: 1, minQuantity: 1 })]), /UNIQUE/);
  db.close();
});

test('batch overflow、sequence、threshold snapshot 與 audit persistence', async () => {
  const { db, repositories } = await setup();
  const service = new GroupBuyBatchService(repositories);
  await service.commitQuantity('member', 'A', 'o', 70, 'req70');
  const rows = await repositories.batches.listForOffering('o');
  assert.deepEqual(rows.map(({ sequence_number, committed_quantity, status, threshold_quantity }) => [sequence_number, committed_quantity, status, threshold_quantity]), [[1,30,'formed',30],[2,30,'formed',30],[3,10,'open',30]]);
  await repositories.batch([repositories.offerings.updateStatement({ id: 'o', priceMinor: 19900, batchThreshold: 24, minQuantity: 1, status: 'active' })]);
  assert.equal((await repositories.batches.listForOffering('o'))[0].threshold_quantity, 30);
  assert.equal((await repositories.audits.list()).filter(({ action_type }) => action_type === 'batch_formed').length, 2);
  db.close();
});

test('request idempotency 與 transaction rollback 不留下半成批次', async () => {
  const { db, repositories } = await setup();
  const service = new GroupBuyBatchService(repositories);
  await service.commitQuantity('member', 'A', 'o', 10, 'same');
  await service.commitQuantity('member', 'A', 'o', 10, 'same');
  assert.equal((await repositories.batches.listForOffering('o'))[0].committed_quantity, 10);
  const before = await repositories.batches.listForOffering('o');
  await assert.rejects(() => repositories.batch([...repositories.batches.allocationStatements({ requestId: 'rollback', offeringId: 'o', quantity: 25, actorUserId: 'missing' })]), /FOREIGN KEY/);
  assert.deepEqual(await repositories.batches.listForOffering('o'), before);
  db.close();
});

test('wish repository 保存資料且 service 執行 membership 規則', async () => {
  const { db, repositories } = await setup();
  const service = new ProductWishService(repositories);
  const wish = await service.create('member', 'A', { wishText: '想要有機蔬菜' });
  assert.equal((await repositories.wishes.findById(wish.id)).wish_text, '想要有機蔬菜');
  seed(db, "INSERT INTO users(id) VALUES ('outsider'); INSERT INTO user_profiles(user_id) VALUES ('outsider');");
  await assert.rejects(() => service.create('outsider', 'A', { wishText: '不允許' }), ({ code }) => code === 'MEMBERSHIP_REQUIRED');
  assert.equal((await repositories.audits.list()).some(({ action_type }) => action_type === 'wish_created'), true);
  db.close();
});
