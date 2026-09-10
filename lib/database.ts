import { Pool, type PoolClient } from "pg";
let pool: Pool | undefined;
export function databaseConfigured() { return Boolean(process.env.VERA_DATABASE_URL); }
export function database(): Pool {
  if (!process.env.VERA_DATABASE_URL) throw new Error("DURABLE_STORAGE_REQUIRED: configure VERA_DATABASE_URL.");
  if (!pool) pool = new Pool({ connectionString: process.env.VERA_DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000, statement_timeout: 15_000 });
  return pool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function closeDatabase() { await pool?.end(); pool = undefined; }
