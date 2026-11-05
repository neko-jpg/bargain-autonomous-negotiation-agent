import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, DatabasePool } from '../../src/lib/negotiation/persistence';

/**
 * Real PostgreSQL (compiled to WASM) behind the app's DatabasePool interface,
 * so the production SQL path runs in `npm test` without a server.
 * PGlite has one connection; a mutex gives each checked-out client exclusive
 * use, which matches how the app scopes transactions to a client.
 */
export async function createPgliteDatabase(): Promise<{ pool: DatabasePool; db: PGlite; close: () => Promise<void> }> {
  const db = await PGlite.create();
  await db.exec(readFileSync(join(__dirname, '..', '..', 'docs', 'POSTGRES_SCHEMA.sql'), 'utf8'));

  let tail: Promise<void> = Promise.resolve();
  const acquire = async () => {
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return release;
  };

  const run = async <T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> => {
    const result = await db.query<T>(text, values as unknown[]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length, command: '', oid: 0, fields: [] } as unknown as QueryResult<T>;
  };

  const pool: DatabasePool = {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      const release = await acquire();
      try { return await run<T>(text, values); } finally { release(); }
    },
    async connect(): Promise<DatabaseClient> {
      const release = await acquire();
      let released = false;
      return {
        query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => run<T>(text, values),
        async release() {
          if (!released) { released = true; release(); }
        },
      };
    },
  };
  return { pool, db, close: () => db.close() };
}
