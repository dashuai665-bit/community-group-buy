import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationUrls = [
  new URL('../../drizzle/0000_melted_otto_octavius.sql', import.meta.url),
  new URL('../../drizzle/0001_sticky_taskmaster.sql', import.meta.url),
  new URL('../../drizzle/0002_magical_gamma_corps.sql', import.meta.url),
  new URL('../../drizzle/0003_bumpy_cannonball.sql', import.meta.url),
  new URL('../../drizzle/0004_purchase_batches.sql', import.meta.url),
];

async function createMigratedDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const migrationUrl of migrationUrls) {
    database.exec(await readFile(migrationUrl, 'utf8'));
  }
  return database;
}

function seedUserAndCommunities(database) {
  database.prepare("INSERT INTO users (id) VALUES ('user-1')").run();
  database.prepare(
    "INSERT INTO communities (id, name, slug) VALUES ('A', 'A 社區', 'a'), ('B', 'B 社區', 'b'), ('C', 'C 社區', 'c')",
  ).run();
}

test('migration 可以重複建立兩個乾淨 SQLite DB，且 foreign_key_check 通過', async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const database = await createMigratedDatabase();
    const tables = database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    ).all();
    assert.deepEqual(
      tables.map(({ name }) => name),
      ['audit_logs', 'batch_commitments', 'communities', 'community_members', 'community_product_offerings', 'group_buy_batches', 'order_items', 'orders', 'pickup_records', 'platform_roles', 'product_wishes', 'products', 'purchase_batch_groups', 'purchase_batches', 'user_identities', 'user_profiles', 'users'],
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    database.close();
  }
});

test('Phase 4A 金額、offering、batch 與 wish constraints 正確', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  database.prepare("INSERT INTO products (id,name,source_type,unit_label) VALUES ('p','米','manual','包')").run();
  assert.throws(() => database.prepare("INSERT INTO community_product_offerings (id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order) VALUES ('bad','A','p',0,30,1)").run(), /CHECK constraint failed/);
  database.prepare("INSERT INTO community_product_offerings (id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order) VALUES ('o','A','p',19900,30,1)").run();
  database.prepare("INSERT INTO group_buy_batches (id,offering_id,sequence_number,threshold_quantity) VALUES ('b1','o',1,30)").run();
  assert.throws(() => database.prepare("INSERT INTO group_buy_batches (id,offering_id,sequence_number,threshold_quantity) VALUES ('b2','o',1,30)").run(), /UNIQUE constraint failed/);
  assert.throws(() => database.prepare("INSERT INTO product_wishes (id,user_id,community_id) VALUES ('w','user-1','A')").run(), /CHECK constraint failed/);
  database.close();
});

test('Phase 4B order idempotency、item linkage、pickup 與 status constraints 正確',async()=>{
  const database=await createMigratedDatabase();seedUserAndCommunities(database);
  database.prepare("INSERT INTO user_profiles(user_id,display_name,phone) VALUES ('user-1','住戶','0900000000')").run();
  database.prepare("INSERT INTO products(id,name,source_type,unit_label) VALUES ('p','米','manual','包')").run();
  database.prepare("INSERT INTO community_product_offerings(id,community_id,product_id,price_minor,batch_threshold,min_quantity_per_order) VALUES ('o','A','p',100,30,1)").run();
  const insert=database.prepare("INSERT INTO orders(id,user_id,community_id,estimated_total_minor,idempotency_key,contact_name_snapshot,contact_phone_snapshot) VALUES (?,?,?,?,?,?,?)");
  insert.run('order-1','user-1','A',100,'same','住戶','0900000000');
  assert.throws(()=>insert.run('order-2','user-1','A',100,'same','住戶','0900000000'),/UNIQUE/);
  assert.throws(()=>database.prepare("INSERT INTO order_items(id,order_id,offering_id,product_id,product_name_snapshot,unit_label_snapshot,unit_price_minor,quantity,estimated_subtotal_minor) VALUES ('i','missing','o','p','米','包',100,1,100)").run(),/FOREIGN KEY/);
  database.prepare("INSERT INTO pickup_records(id,order_id,community_id) VALUES ('pickup','order-1','A')").run();
  assert.throws(()=>database.prepare("UPDATE pickup_records SET status='unknown'").run(),/CHECK/);
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

test('同一 user 可加入三個社區，複合唯一限制拒絕重複 membership', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  const insert = database.prepare(
    'INSERT INTO community_members (id, user_id, community_id) VALUES (?, ?, ?)',
  );
  for (const communityId of ['A', 'B', 'C']) {
    insert.run(`member-${communityId}`, 'user-1', communityId);
  }
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM community_members WHERE user_id = 'user-1'").get().count,
    3,
  );
  assert.throws(() => insert.run('duplicate', 'user-1', 'A'), /UNIQUE constraint failed/);
  database.close();
});

test('default_community_id 的複合外鍵要求 user 已有該 membership', async () => {
  const database = await createMigratedDatabase();
  seedUserAndCommunities(database);
  assert.throws(
    () => database.prepare(
      "INSERT INTO user_profiles (user_id, default_community_id) VALUES ('user-1', 'A')",
    ).run(),
    /FOREIGN KEY constraint failed/,
  );
  database.prepare(
    "INSERT INTO community_members (id, user_id, community_id) VALUES ('member-A', 'user-1', 'A')",
  ).run();
  database.prepare(
    "INSERT INTO user_profiles (user_id, default_community_id) VALUES ('user-1', 'A')",
  ).run();
  database.close();
});

test('provider identity 唯一限制與 user foreign key 正確', async () => {
  const database = await createMigratedDatabase();
  database.prepare("INSERT INTO users (id) VALUES ('user-1'), ('user-2')").run();
  const insert = database.prepare(
    'INSERT INTO user_identities (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)',
  );
  insert.run('identity-1', 'user-1', 'google', 'provider-subject');
  assert.throws(
    () => insert.run('identity-2', 'user-2', 'google', 'provider-subject'),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => insert.run('identity-3', 'missing-user', 'line', 'line-subject'),
    /FOREIGN KEY constraint failed/,
  );
  database.close();
});

test('相同 email 與 phone 可屬於不同 users，verification 欄位彼此獨立', async () => {
  const database = await createMigratedDatabase();
  database.prepare("INSERT INTO users (id) VALUES ('user-1'), ('user-2')").run();
  const insert = database.prepare(
    'INSERT INTO user_profiles (user_id, phone, phone_verified, email, email_verified) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run('user-1', '0912345678', 'false', 'same@example.test', 'true');
  insert.run('user-2', '0912345678', 'false', 'same@example.test', 'false');
  const profiles = database.prepare('SELECT * FROM user_profiles ORDER BY user_id').all();
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].phone_verified, 'false');
  assert.equal(profiles[0].email_verified, 'true');
  database.close();
});

test('status、join_policy、role、provider 與 verified check constraints 正確', async () => {
  const database = await createMigratedDatabase();
  assert.throws(
    () => database.prepare("INSERT INTO users (id, status) VALUES ('bad-user', 'unknown')").run(),
    /CHECK constraint failed/,
  );
  database.prepare("INSERT INTO users (id) VALUES ('user-1')").run();
  assert.throws(
    () => database.prepare(
      "INSERT INTO communities (id, name, slug, join_policy) VALUES ('bad', 'Bad', 'bad', 'join_code')",
    ).run(),
    /CHECK constraint failed/,
  );
  database.prepare(
    "INSERT INTO communities (id, name, slug) VALUES ('A', 'A 社區', 'a')",
  ).run();
  assert.throws(
    () => database.prepare(
      "INSERT INTO community_members (id, user_id, community_id, role) VALUES ('bad-role', 'user-1', 'A', 'platform_admin')",
    ).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => database.prepare(
      "INSERT INTO user_identities (id, user_id, provider, provider_user_id) VALUES ('bad-provider', 'user-1', 'github', 'subject')",
    ).run(),
    /CHECK constraint failed/,
  );
  database.close();
});
