import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

interface IncomingEvent {
  eventId: string;
  type: string;
  data: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) { }

  async ingest(event: IncomingEvent) {
    // ON CONFLICT DO NOTHING makes re-submitting the same eventId a no-opat ingestion.
    // This is the first of two duplicate protections —second is UNIQUE constraint on 
    // processed_orders itself, which holds even if this one were somehow bypassed.
    const result = await this.pool.query(
      `INSERT INTO webhook_events (event_id, type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [event.eventId, event.type, event.data],
    );
    return { accepted: true, isNew: result.rowCount === 1 };
  }

  async listEvents() {
    // One query, not N+1: attempt history is aggregated per event via a
    // correlated subquery, so the ops page can show processing history and
    // error messages (required behaviour 9) without a round trip per row.
    const { rows } = await this.pool.query(
      `SELECT e.event_id, e.type, e.status, e.attempt_count, e.max_attempts,
              e.created_at, e.updated_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'attempt_number', a.attempt_number,
                   'worker_id', a.worker_id,
                   'started_at', a.started_at,
                   'finished_at', a.finished_at,
                   'result', a.result,
                   'error', a.error
                 ) ORDER BY a.attempt_number)
                 FROM attempt_history a WHERE a.event_id = e.event_id),
                '[]'
              ) AS attempts
       FROM webhook_events e
       ORDER BY e.created_at DESC
       LIMIT 200`,
    );
    return rows;
  }

  async getEventDetail(eventId: string) {
    const event = await this.pool.query(`SELECT * FROM webhook_events WHERE event_id = $1`, [eventId]);
    const attempts = await this.pool.query(
      `SELECT * FROM attempt_history WHERE event_id = $1 ORDER BY attempt_number ASC`,
      [eventId],
    );
    return { event: event.rows[0] ?? null, attempts: attempts.rows };
  }

  async manualRetry(eventId: string) {
    // Resets to a fresh attempt budget (attempt_count back to 0) rather than
    // granting exactly one more try. Prior attempt_history rows are kept —
    // this only changes what happens next, not what already happened.
    const { rows } = await this.pool.query(
      `UPDATE webhook_events
       SET status = 'pending',
           attempt_count = 0,
           next_attempt_at = now(),
           locked_by = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE event_id = $1 AND status = 'permanently_failed'
       RETURNING event_id`,
      [eventId],
    );
    return { retried: rows.length === 1 };
  }
}
