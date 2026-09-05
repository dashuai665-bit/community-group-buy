import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

class SQLiteStatement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { const statement = new SQLiteStatement(this.database, this.sql); statement.values = values; return statement; }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return { success: true, meta: this.database.prepare(this.sql).run(...this.values) }; }
}

export class SQLiteD1Database {
  constructor(database = new DatabaseSync(':memory:')) {
    this.database = database;
    this.database.exec('PRAGMA foreign_keys = ON');
    this.batchTail = Promise.resolve();
  }
  prepare(sql) { return new SQLiteStatement(this.database, sql); }
  async batch(statements) {
    const execute = async () => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.database.exec('COMMIT');
        return results;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };
    const result = this.batchTail.then(execute, execute);
    this.batchTail = result.catch(() => undefined);
    return result;
  }
  exec(sql) { this.database.exec(sql); }
  close() { this.database.close(); }
}

export async function createPhase3Database() {
  const db = new SQLiteD1Database();
  for (const file of ['../../drizzle/0000_melted_otto_octavius.sql', '../../drizzle/0001_sticky_taskmaster.sql','../../drizzle/0002_magical_gamma_corps.sql','../../drizzle/0003_bumpy_cannonball.sql','../../drizzle/0004_purchase_batches.sql','../../drizzle/0005_purchase_finalization.sql','../../drizzle/0006_order_fulfillment.sql','../../drizzle/0007_audit_logs_append_only.sql']) {
    db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  return db;
}

export async function createPhase4Database() {
  return createPhase3Database();
}

export async function createPhase4BDatabase() {
  return createPhase4Database();
}

export function seed(db, sql) { db.exec(sql); }
