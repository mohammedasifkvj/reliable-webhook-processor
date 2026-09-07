import { Pool } from 'pg';
import { WorkerService } from '../src/events/worker.service';

describe('crash recovery via lease expiry', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const worker = new WorkerService(pool as any);
  const eventId = `evt-crash-${Date.now()}`;

  beforeAll(async () => {
    // Simulate a worker that claimed this event and then crashed before
    // finishing: status is 'processing' (as claimOne would leave it), but
    // the lease is already expired — exactly the state a dead worker leaves
    // behind, without needing to actually kill a process in a unit test.
    await pool.query(
      `INSERT INTO webhook_events (event_id, type, payload, status, locked_by, lease_expires_at)
       VALUES ($1, 'order.created', $2, 'processing', 'dead-worker', now() - interval '1 second')`,
      [eventId, JSON.stringify({ orderId: 'ORD-CRASH', simulate: 'ok' })],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lets a second worker reclaim and complete an abandoned event, with no duplicate row', async () => {
    const didWork = await worker.runOnce('worker-b');
    expect(didWork).toBe(true);

    const event = await pool.query(`SELECT status FROM webhook_events WHERE event_id = $1`, [eventId]);
    expect(event.rows[0].status).toBe('succeeded');

    const orders = await pool.query(`SELECT * FROM processed_orders WHERE event_id = $1`, [eventId]);
    expect(orders.rows.length).toBe(1);

    const attempts = await pool.query(`SELECT worker_id FROM attempt_history WHERE event_id = $1`, [eventId]);
    expect(attempts.rows.length).toBe(1);
    expect(attempts.rows[0].worker_id).toBe('worker-b');
  });
});
