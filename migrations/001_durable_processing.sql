BEGIN;
CREATE TABLE IF NOT EXISTS vera_jobs (
  client_id text NOT NULL,
  id uuid NOT NULL,
  request_key text NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','COMPLETE','ERROR')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  result jsonb,
  error text,
  PRIMARY KEY (client_id,id), UNIQUE(client_id,request_key)
);
CREATE INDEX IF NOT EXISTS vera_jobs_claim ON vera_jobs(client_id,status,available_at,created_at);
CREATE TABLE IF NOT EXISTS vera_checkpoints (
  client_id text NOT NULL, job_id uuid NOT NULL, key text NOT NULL,
  value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(client_id,job_id,key),
  FOREIGN KEY(client_id,job_id) REFERENCES vera_jobs(client_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS vera_batches (
  client_id text NOT NULL, id uuid NOT NULL, manifest jsonb NOT NULL,
  PRIMARY KEY(client_id,id)
);
CREATE TABLE IF NOT EXISTS vera_decision_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id text NOT NULL, review_id text NOT NULL, check_id text NOT NULL,
  decision jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vera_decisions_review ON vera_decision_events(client_id,review_id,check_id,sequence DESC);
COMMIT;
