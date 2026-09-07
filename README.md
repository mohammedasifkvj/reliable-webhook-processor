# Reliable Webhook Processor

Payment-style order webhook processor, in the spirit of PayPal's webhooks: at-least-once
delivery, no ordering guarantees, receiver responsible for idempotency.

## Prerequisites

- Docker and Docker Compose
- Ports `3000`, `3001`, and `5433` free on the host

## Quickstart

    git clone https://github.com/mohammedasifkvj/reliable-webhook-processor.git
    cd reliable-webhook-processor
    docker compose up

Starts Postgres, the API (`:3001`), two workers, and the ops page (`:3000`). Schema is
applied automatically on first Postgres startup; no `.env` file is needed for this path.

Run the tests (they talk to the same Postgres, so stop the workers first so they don't
race the tests' own claims):

    docker compose stop worker-1 worker-2
    docker compose exec postgres psql -U webhooks -d webhooks \
      -c "TRUNCATE webhook_events, processed_orders, attempt_history CASCADE;"
    cd backend && npm install
    DATABASE_URL=postgres://webhooks:webhooks@localhost:5433/webhooks npm test
    cd .. && docker compose start worker-1 worker-2

## Local development (outside Docker)

    docker compose up postgres
    cd backend && cp .env.example .env && npm install && npm run start:api:dev
    cd frontend && cp .env.example .env && npm install && npm run dev

`.env.example` in each folder lists every variable the code actually reads; both `.env`
files are git-ignored.

## Architecture

- **Ingestion**: `POST /webhooks` inserts into `webhook_events` (`event_id UNIQUE`,
  `ON CONFLICT DO NOTHING`) and acknowledges before any processing.
- **Queue**: Postgres, not Redis — one indexed table doubles as the job queue, which lets
  the business action and the queue-state change share a transaction.
- **Claiming**: `SELECT ... FOR UPDATE SKIP LOCKED` is the entire concurrency guarantee —
  two workers running it at once can't lock the same row.
- **Business action**: success writes `processed_orders` and marks the event `succeeded`
  in one transaction — never one without the other.
- **Retries**: failures log to `attempt_history` with exponential backoff via
  `next_attempt_at`; `permanently_failed` once `attempt_count >= max_attempts`.
- **Crash recovery**: every claim sets `lease_expires_at` (`LEASE_SECONDS`, default 30s).
  An expired lease is treated as claimable again — a crashed worker's event is picked back
  up with no separate reaper process.
- **Manual retry**: `POST /events/:eventId/retry` resets a `permanently_failed` event to
  `pending` with a fresh attempt budget; history is preserved.
- **Ops page**: server-rendered table at `:3000` reading `GET /events`. Retries submit
  through a Next.js API route (`pages/api/retry/[eventId].ts`) rather than posting directly
  to the backend, since the browser can't resolve docker-compose's internal `api` hostname
  that server-side code uses.
- **PayPal signature verification** (`src/paypal/`): offline RSA-SHA256 verification (no
  call to PayPal's API), active only when real PayPal headers are present.

## Correctness guarantees

- **Duplicate protection**, twice over: `UNIQUE` on `webhook_events.event_id` at ingestion
  and on `processed_orders.event_id` at completion — either alone guarantees at most one row.
- **Concurrency**: `SKIP LOCKED` in a single round trip leaves no check-then-claim race window.
- **Crash recovery**: a worker that dies before its transaction commits has written nothing,
  so reclaiming behaves like a fresh attempt.

## Known limitations

- A `slow:N` event outliving `LEASE_SECONDS` can be reclaimed by a second worker while the
  first is still running. The `UNIQUE` constraint still prevents a duplicate
  `processed_orders` row, but you'll see two `attempt_history` rows for the same attempt
  number. A lease-renewal heartbeat would close this; not implemented.
- Claiming polls (`POLL_INTERVAL_MS`, 500ms) instead of using `LISTEN`/`NOTIFY` — fine at
  this scale, adds up to one interval of latency.
- PayPal signature verification only runs when real PayPal headers are present; the
  assessment's test events don't send them, so that path isn't exercised by grading.
- Tests assume nothing else is claiming events during the run. Running them alongside live
  workers, or in parallel with each other, races the same shared table — run with
  `--runInBand` and with docker-compose's workers stopped (see Quickstart).
- `GET /events` caps at 200 rows — fine for the burst demo, not built for scale.

## Hardest bug

`DATABASE_URL` looked correct in `.env`, but every DB query failed with
`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` — an error that sounds
like a wrong password, not a missing one. The API's own terminal logs (not the HTTP 500
body) pointed into `pg-pool` during `Pool.connect()`: `pg` had received no password at
all — `undefined`, not even an empty string — which makes SCRAM's handshake throw a type
error rather than a normal auth failure.

Root cause: plain Node doesn't read `.env` files automatically. Nothing called `dotenv`, so
`process.env.DATABASE_URL` was `undefined` regardless of the file's contents, and `pg` fell
back to passwordless defaults. Fix: `import 'dotenv/config'` as the first line of both
entrypoints (`main.ts`, `worker.ts`).

## What's next

- Lease-renewal heartbeat for long-running events (closes the gap above).
- `LISTEN`/`NOTIFY` instead of polling.
- Pagination and filtering on the ops page.
- Structured, queryable per-attempt logging.

## Tests

- `concurrency.spec.ts` — two simultaneous claims on one event → exactly one
  `processed_orders` row.
- `retry.spec.ts` — `fail_then_succeed:2` → two failures then success, full history, one
  order row.
- `crash-recovery.spec.ts` — seeds an event with an already-expired lease (what a dead
  worker leaves behind) → a second worker reclaims and completes it, no duplicate.

Run command is in Quickstart above.

## Demo scenarios

    ./scripts/demo.sh duplicate
    ./scripts/demo.sh temp-failure
    ./scripts/demo.sh permanent-failure
    ./scripts/demo.sh parallel
    ./scripts/demo.sh crash        # then: docker compose kill worker-1
    ./scripts/demo.sh burst

To test the ops page's Retry button directly without waiting out real backoff, seed a
`permanently_failed` row straight in the DB:

    docker compose exec postgres psql -U webhooks -d webhooks -c "
      INSERT INTO webhook_events (event_id, type, payload, status, attempt_count, max_attempts)
      VALUES ('evt-ui-test-1', 'order.created',
              '{\"orderId\":\"ORD-UI-1\",\"simulate\":\"always_fail\"}',
              'permanently_failed', 5, 5);
    "

Refresh the ops page, click Retry on `evt-ui-test-1`, and confirm it flips to `pending` and
starts processing again (it'll fail and land back on `permanently_failed`, since it's still
`always_fail` — that's expected; the point is confirming the button re-triggers processing).