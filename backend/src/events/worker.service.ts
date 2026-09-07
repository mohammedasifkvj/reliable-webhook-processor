import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { resolveSimulate } from './simulate';

const LEASE_SECONDS = Number(process.env.LEASE_SECONDS ?? 30);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 500);
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class WorkerService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) { }

  async runForever(workerId: string): Promise<never> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const didWork = await this.runOnce(workerId);
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    }
  }

  // /** Claims and processes at most one event. Returns whether it found work.
  async runOnce(workerId: string): Promise<boolean> {
    const claimed = await this.claimOne(workerId);
    if (!claimed) return false;
    await this.process(claimed, workerId);
    return true;
  }


  //   Atomically claims one eligible event: either a fresh 'pending' row whose
  //  backoff has elapsed, or a 'processing' row whose lease has expired
  //  (the worker that held it died or crashed before finishing).

  //   SKIP LOCKED is the entire concurrency guarantee: two workers running
  //   this query at the same instant physically cannot lock the same row, so
  //   they can never both claim (or process) the same event.
  private async claimOne(workerId: string) {
    const { rows } = await this.pool.query(
      `UPDATE webhook_events
       SET status = 'processing',
           locked_by = $1,
           lease_expires_at = now() + ($2 || ' seconds')::interval,
           updated_at = now()
       WHERE id = (
         SELECT id FROM webhook_events
         WHERE (status = 'pending' AND next_attempt_at <= now())
            OR (status = 'processing' AND lease_expires_at < now())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, LEASE_SECONDS],
    );
    return rows[0] ?? null;
  }

  private async process(event: any, workerId: string) {
    const attemptNumber = event.attempt_count + 1;
    const startedAt = new Date();
    const outcome = resolveSimulate(event.payload?.simulate, attemptNumber);

    if (outcome.delayMs > 0) {
      await sleep(outcome.delayMs);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (!outcome.shouldFail) {
        // Business action + status update share one transaction:it isimpossible to write 
        // processed_orders without also marking event succeeded, or vice versa.
        await client.query(
          `INSERT INTO processed_orders (order_id, event_id)
           VALUES ($1, $2)
           ON CONFLICT (event_id) DO NOTHING`,
          [event.payload?.orderId ?? null, event.event_id],
        );
        await client.query(
          `UPDATE webhook_events
           SET status = 'succeeded', attempt_count = $1,
               locked_by = NULL, lease_expires_at = NULL, updated_at = now()
           WHERE event_id = $2`,
          [attemptNumber, event.event_id],
        );
        await client.query(
          `INSERT INTO attempt_history (event_id, attempt_number, worker_id, started_at, finished_at, result)
           VALUES ($1, $2, $3, $4, now(), 'success')`,
          [event.event_id, attemptNumber, workerId, startedAt],
        );
      } else {
        const permanentlyFailed = attemptNumber >= event.max_attempts;
        const backoffMs = BASE_BACKOFF_MS * 2 ** (attemptNumber - 1);

        await client.query(
          `UPDATE webhook_events
           SET status = $1,
               attempt_count = $2,
               next_attempt_at = now() + ($3 || ' milliseconds')::interval,
               locked_by = NULL, lease_expires_at = NULL, updated_at = now()
           WHERE event_id = $4`,
          [permanentlyFailed ? 'permanently_failed' : 'pending', attemptNumber, backoffMs, event.event_id],
        );
        await client.query(
          `INSERT INTO attempt_history (event_id, attempt_number, worker_id, started_at, finished_at, result, error)
           VALUES ($1, $2, $3, $4, now(), 'failure', $5)`,
          [event.event_id, attemptNumber, workerId, startedAt, `simulated failure (${event.payload?.simulate})`],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.error(`[${workerId}] error processing ${event.event_id}`, err);
    } finally {
      client.release();
    }
  }
}
