import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createPhase3Database } from '../helpers/sqlite-database.mjs';
import { createCanonicalDatabase, normalizeSql, schemaSnapshot } from '../helpers/canonical-schema.mjs';

const inventory = JSON.parse(await readFile(new URL('../../database/canonical/inventory.json', import.meta.url), 'utf8'));

test('canonical equals unmodified historical 0000-0007: SQL and all structural PRAGMAs', async t => {
  const historical = await createPhase3Database(); t.after(() => historical.close());
  const canonical = await createCanonicalDatabase(); t.after(() => canonical.close());
  assert.deepEqual(schemaSnapshot(canonical), schemaSnapshot(historical.database));
  for (const db of [historical.database,canonical]) {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    for (const type of ['table','index','trigger']) {
      const names = db.prepare('SELECT name FROM sqlite_master WHERE type=? AND sql IS NOT NULL ORDER BY name').all(type).map(o => o.name);
      assert.deepEqual(names,inventory[type], `${type} name inventory`);
    }
    for (const name of inventory.table) assert.equal(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n,0,`${name} has no seed data`);
  }
  assert.equal(inventory.table.length,22);
  assert.equal(inventory.trigger.length,22);
});

test('normalization tolerates layout and identifier quoting without hiding constraints or literals', () => {
  assert.deepEqual(normalizeSql('CREATE TABLE `example` ( `id` TEXT CHECK (`id` != \'a b\'))'),normalizeSql('create table "example"(id text check(id!=\'a b\'))'));
  for (const [a,b] of [
    ["CHECK(x > 0)","CHECK(x >= 0)"],
    ["ON DELETE RESTRICT","ON DELETE CASCADE"],
    ["CREATE UNIQUE INDEX i ON t(x)","CREATE INDEX i ON t(x)"],
    ["SELECT RAISE(ABORT,'a b')","SELECT RAISE(ABORT,'ab')"],
    ["DEFAULT 'TWD'","DEFAULT 'twd'"],
  ]) assert.notDeepEqual(normalizeSql(a),normalizeSql(b));
});

test('equivalence comparison detects missing index, altered trigger and changed CHECK', async t => {
  const db = await createCanonicalDatabase(); t.after(() => db.close());
  const expected = schemaSnapshot(db);
  db.exec('DROP INDEX purchase_allocations_order_item_idx');
  assert.notDeepEqual(schemaSnapshot(db),expected);
  db.exec('CREATE INDEX purchase_allocations_order_item_idx ON purchase_allocations(order_item_id)');
  assert.deepEqual(schemaSnapshot(db),expected);
  db.exec("DROP TRIGGER audit_logs_immutable_update; CREATE TRIGGER audit_logs_immutable_update BEFORE UPDATE ON audit_logs BEGIN SELECT 1; END;");
  assert.notDeepEqual(schemaSnapshot(db),expected);
  const sql = await readFile(new URL('../../database/canonical/current-schema.sql', import.meta.url), 'utf8');
  const changed = sql.replace('CHECK(`final_amount_minor` >= 0)', 'CHECK(`final_amount_minor` > 0)');
  assert.notEqual(changed, sql);
  const altered = new DatabaseSync(':memory:'); t.after(() => altered.close());
  altered.exec(changed);
  assert.notDeepEqual(schemaSnapshot(altered),expected);
});
