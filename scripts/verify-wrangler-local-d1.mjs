import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import inventory from '../database/canonical/inventory.json' with { type: 'json' };

const persistencePath = mkdtempSync(join(tmpdir(), 'linli-wrangler-proof-'));

function wrangler(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js',...args,'--persist-to',persistencePath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || 'Wrangler failed');
  return `${result.stdout}\n${result.stderr}`;
}

function findApplicationDatabase(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findApplicationDatabase(path);
      if (found) return found;
    } else if (entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') return path;
  }
}

try {
  const first = wrangler(['d1','migrations','apply','DB','--local']);
  if (!first.includes('0000_current_schema.sql')) throw new Error('Production baseline was not applied');
  const second = wrangler(['d1','migrations','apply','DB','--local']);
  if (!second.includes('No migrations to apply')) throw new Error('Second migration apply was not a no-op');
  const databasePath = findApplicationDatabase(persistencePath);
  if (!databasePath) throw new Error('Wrangler local D1 file was not found');
  const database = new DatabaseSync(databasePath);
  const objectExists = database.prepare('SELECT 1 found FROM sqlite_master WHERE type=? AND name=? AND sql IS NOT NULL');
  for (const [type, names] of Object.entries(inventory)) {
    for (const name of names) if (!objectExists.get(type, name)) throw new Error(`Missing ${type}: ${name}`);
  }
  const ledger = database.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row => row.name);
  const result = {
    tables: inventory.table.length,
    indexes: inventory.index.length,
    triggers: inventory.trigger.length,
    ledger,
    foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all(),
    secondApply: 'NO_PENDING_MIGRATIONS',
  };
  database.close();
  if (result.tables !== 26 || result.indexes !== 36 || result.triggers !== 22) throw new Error(`Unexpected inventory: ${JSON.stringify(result)}`);
  if (result.ledger.length !== 1 || result.ledger[0] !== '0000_current_schema.sql') throw new Error(`Unexpected ledger: ${JSON.stringify(result.ledger)}`);
  if (result.foreignKeyViolations.length !== 0) throw new Error('Foreign key check failed');
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(persistencePath, { recursive: true, force: true });
}
