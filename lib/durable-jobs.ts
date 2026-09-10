import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { database, transaction } from "./database";
import { clientInstanceConfig } from "./client-instance";
export interface JobInput { pathname: string; state: string; searchType: string; clientName: string; }
export interface Job { id: string; input: JobInput; status: "QUEUED" | "PROCESSING" | "COMPLETE" | "ERROR"; attempts: number; lease_token: string; result?: unknown; error?: string; }
const scope = () => clientInstanceConfig().clientId;
const context = new AsyncLocalStorage<{ id: string; token: string }>();
export const withJobContext = <T>(job: Job, fn: () => Promise<T>) => context.run({ id: job.id, token: job.lease_token }, fn);

export async function enqueueJob(input: JobInput): Promise<Job> {
  const requestKey = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const { rows } = await database().query(`INSERT INTO vera_jobs(client_id,id,request_key,input) VALUES($1,$2,$3,$4)
    ON CONFLICT(client_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *`, [scope(), randomUUID(), requestKey, input]);
  return rows[0];
}
export async function readJob(id: string): Promise<Job | null> {
  const { rows } = await database().query("SELECT * FROM vera_jobs WHERE client_id=$1 AND id=$2", [scope(), id]);
  return rows[0] || null;
}
export async function claimJob(): Promise<Job | null> {
  // Exhausted leases become visible errors instead of remaining stuck forever.
  await database().query(`UPDATE vera_jobs SET status='ERROR',error='Worker retry budget exhausted',updated_at=now()
    WHERE client_id=$1 AND status='PROCESSING' AND lease_until < now() AND attempts>=3`, [scope()]);
  const { rows } = await database().query(`WITH candidate AS (
    SELECT id FROM vera_jobs WHERE client_id=$1 AND attempts<3
      AND ((status='QUEUED' AND available_at<=now()) OR (status='PROCESSING' AND lease_until<now()))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE vera_jobs j SET status='PROCESSING',attempts=attempts+1,lease_token=$2,
    lease_until=now()+interval '90 seconds',updated_at=now(),error=NULL
    FROM candidate WHERE j.client_id=$1 AND j.id=candidate.id RETURNING j.*`, [scope(), randomUUID()]);
  return rows[0] || null;
}
export async function heartbeat(job: Job): Promise<boolean> {
  const result = await database().query(`UPDATE vera_jobs SET lease_until=now()+interval '90 seconds',updated_at=now()
    WHERE client_id=$1 AND id=$2 AND lease_token=$3 AND status='PROCESSING' AND lease_until>now()`, [scope(), job.id, job.lease_token]);
  return result.rowCount === 1;
}
export async function finishJob(job: Job, result: unknown): Promise<boolean> {
  const saved = await database().query(`UPDATE vera_jobs SET status='COMPLETE',result=$4,lease_until=NULL,updated_at=now()
    WHERE client_id=$1 AND id=$2 AND lease_token=$3 AND status='PROCESSING' AND lease_until>now()`, [scope(), job.id, job.lease_token, result]);
  return saved.rowCount === 1;
}
export async function failJob(job: Job): Promise<void> {
  await database().query(`UPDATE vera_jobs SET status=CASE WHEN attempts>=3 THEN 'ERROR' ELSE 'QUEUED' END,
    error='Processing interrupted; retrying within the job budget',available_at=now()+interval '30 seconds',lease_until=NULL,updated_at=now()
    WHERE client_id=$1 AND id=$2 AND lease_token=$3 AND status='PROCESSING' AND lease_until>now()`, [scope(), job.id, job.lease_token]);
}
export async function checkpoint<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const job = context.getStore();
  if (!job) return fn();
  const existing = await database().query("SELECT value FROM vera_checkpoints WHERE client_id=$1 AND job_id=$2 AND key=$3", [scope(), job.id, key]);
  if (existing.rows.length) return existing.rows[0].value as T;
  const value = await fn();
  await transaction(async (db) => {
    const lease = await db.query(`SELECT id FROM vera_jobs WHERE client_id=$1 AND id=$2 AND lease_token=$3
      AND status='PROCESSING' AND lease_until>now() FOR UPDATE`, [scope(), job.id, job.token]);
    if (!lease.rows.length) throw new Error("JOB_LEASE_LOST: checkpoint was not committed.");
    await db.query(`INSERT INTO vera_checkpoints(client_id,job_id,key,value) VALUES($1,$2,$3,$4)
      ON CONFLICT(client_id,job_id,key) DO NOTHING`, [scope(), job.id, key, JSON.stringify(value)]);
  });
  return value;
}
