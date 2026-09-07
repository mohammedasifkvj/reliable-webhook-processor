import { Pool } from 'pg';
import { WorkerService } from '../src/events/worker.service';

/**
 * Integration test — requires a running Postgres reachable via DATABASE_URL
 * with db/init.sql already applied (e.g. `docker compose up postgres`).
 */
describe('concurrent claim + duplicate protection', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const worker = new WorkerService(pool as any);
  const eventId = `evt-concurrency-${Date.now()}`;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO webhook_events (event_id, type, payload) VALUES ($1, 'order.created', $2)`,
      [eventId, JSON.stringify({ orderId: 'ORD-CONC', simulate: 'ok' })],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('never lets two workers process the same event, and writes exactly one processed_orders row', async () => {
    // Two "workers" racing the claim query against the same event.
    const [a, b] = await Promise.all([worker.runOnce('worker-a'), worker.runOnce('worker-b')]);

    // Exactly one of the two calls should have found the event to claim;
    // the other should see nothing left to do.
    expect([a, b].filter(Boolean).length).toBe(1);

    const { rows } = await pool.query(`SELECT * FROM processed_orders WHERE event_id = $1`, [eventId]);
    expect(rows.length).toBe(1);

    const attempts = await pool.query(`SELECT * FROM attempt_history WHERE event_id = $1`, [eventId]);
    expect(attempts.rows.length).toBe(1);
  });
});
