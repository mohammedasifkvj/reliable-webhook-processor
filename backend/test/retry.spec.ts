import { Pool } from 'pg';
import { WorkerService } from '../src/events/worker.service';

describe('retry with backoff and eventual success', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const worker = new WorkerService(pool as any);
  const eventId = `evt-retry-${Date.now()}`;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO webhook_events (event_id, type, payload, max_attempts) VALUES ($1, 'order.created', $2, 5)`,
      [eventId, JSON.stringify({ orderId: 'ORD-RETRY', simulate: 'fail_then_succeed:2' })],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('fails twice, succeeds on the third attempt, and records the full history', async () => {
    // Run twice (both fail), then force next_attempt_at into the past so
    // the test doesn't have to wait out real exponential backoff.
    for (let i = 0; i < 2; i++) {
      await worker.runOnce('worker-a');
      await pool.query(
        `UPDATE webhook_events SET next_attempt_at = now() - interval '1 second' WHERE event_id = $1`,
        [eventId],
      );
    }
    await worker.runOnce('worker-a');

    const event = await pool.query(`SELECT status, attempt_count FROM webhook_events WHERE event_id = $1`, [
      eventId,
    ]);
    expect(event.rows[0].status).toBe('succeeded');
    expect(event.rows[0].attempt_count).toBe(3);

    const attempts = await pool.query(
      `SELECT result FROM attempt_history WHERE event_id = $1 ORDER BY attempt_number`,
      [eventId],
    );
    expect(attempts.rows.map((r) => r.result)).toEqual(['failure', 'failure', 'success']);

    const order = await pool.query(`SELECT * FROM processed_orders WHERE event_id = $1`, [eventId]);
    expect(order.rows.length).toBe(1);
  });
});
