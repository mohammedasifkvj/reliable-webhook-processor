CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS webhook_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         TEXT UNIQUE NOT NULL,
  type             TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'succeeded', 'permanently_failed')),
  attempt_count    INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 5,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by        TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the claim query: fresh work ready to run.
CREATE INDEX IF NOT EXISTS idx_webhook_events_claimable
  ON webhook_events (next_attempt_at)
  WHERE status = 'pending';

-- Supports the claim query: crashed/stuck work whose lease has expired.
CREATE INDEX IF NOT EXISTS idx_webhook_events_expired_lease
  ON webhook_events (lease_expires_at)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS processed_orders (
  order_id     TEXT NOT NULL,
  event_id     TEXT UNIQUE NOT NULL REFERENCES webhook_events(event_id),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attempt_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       TEXT NOT NULL REFERENCES webhook_events(event_id),
  attempt_number INT NOT NULL,
  worker_id      TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ,
  result         TEXT CHECK (result IN ('success', 'failure')),
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_attempt_history_event
  ON attempt_history (event_id, attempt_number);
