import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

export async function createCanonicalDatabase() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(await readFile(new URL('../../database/canonical/current-schema.sql', import.meta.url), 'utf8'));
    return db;
  } catch (error) { db.close(); throw error; }
}

// Tokenize instead of stripping whitespace inside literals. Only simple quoted
// identifiers are unquoted; string literals, operators and token order survive.
export function normalizeSql(sql) {
  if (sql === null) return null;
  const lexer = /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|<>|!=|<=|>=|==|\|\||[^\s]/gy;
  const tokens = [];
  let end = 0;
  for (const match of sql.matchAll(lexer)) {
    if (match.index !== end) throw new Error('Unrecognized SQL token');
    let token = match[0]; end += token.length;
    if (/^(?:\s|--|\/\*)/.test(token)) continue;
    if (/^(?:"[A-Za-z_][A-Za-z_0-9]*"|`[A-Za-z_][A-Za-z_0-9]*`|\[[A-Za-z_][A-Za-z_0-9]*\])$/.test(token)) token = token.slice(1, -1);
    tokens.push(/^[A-Za-z_][A-Za-z_0-9]*$/.test(token) ? token.toLowerCase() : token);
  }
  if (end !== sql.length) throw new Error('Incomplete SQL tokenization');
  return tokens;
}

export function schemaSnapshot(db) {
  const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY type,name").all();
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  const tables = objects.filter(o => o.type === 'table').map(({name}) => ({
    name,
    columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all(),
    extendedColumns: db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all(),
    indexes: db.prepare(`PRAGMA index_list(${quote(name)})`).all().map(({seq: _seq,...index}) => ({
      ...index,
      columns: db.prepare(`PRAGMA index_info(${quote(index.name)})`).all(),
      extendedColumns: db.prepare(`PRAGMA index_xinfo(${quote(index.name)})`).all(),
    })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  }));
  return {objects: objects.map(o => ({...o,sql: normalizeSql(o.sql)})),tables};
}
