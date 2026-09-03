export interface QueryResult<T = unknown> { results?: T[]; success?: boolean; meta?: unknown }

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch<T = unknown>(statements: SqlStatement[]): Promise<QueryResult<T>[]>;
}

export interface RepositoryContext { db: SqlDatabase }
