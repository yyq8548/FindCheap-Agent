import { Pool, type QueryResultRow } from "pg";

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface Database extends SqlExecutor {
  connect(): Promise<void>;
  close(): Promise<void>;
  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
}

export type DatabaseTimeouts = {
  statementTimeoutMs?: number;
  queryTimeoutMs?: number;
  connectionTimeoutMs?: number;
};

export function createDatabase(connectionString: string, timeouts: DatabaseTimeouts = {}): Database {
  const pool = new Pool({
    connectionString,
    ...(timeouts.statementTimeoutMs === undefined ? {} : { statement_timeout: timeouts.statementTimeoutMs }),
    ...(timeouts.queryTimeoutMs === undefined ? {} : { query_timeout: timeouts.queryTimeoutMs }),
    ...(timeouts.connectionTimeoutMs === undefined
      ? {}
      : { connectionTimeoutMillis: timeouts.connectionTimeoutMs })
  });

  return {
    async connect() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values: readonly unknown[] = []) {
      const result = await pool.query<Row>(sql, [...values]);
      return { rows: result.rows };
    },
    async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const transaction: SqlExecutor = {
          async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values: readonly unknown[] = []) {
            const result = await client.query<Row>(sql, [...values]);
            return { rows: result.rows };
          }
        };
        const result = await work(transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
