import { GetServerSideProps } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

function formatDateTime(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

interface Attempt {
  attempt_number: number;
  worker_id: string;
  started_at: string;
  finished_at: string | null;
  result: string;
  error: string | null;
}

interface EventRow {
  event_id: string;
  type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  attempts: Attempt[];
}

export default function OpsPage({ events, error }: { events: EventRow[]; error: string | null }) {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Webhook events</h1>
      <p>Plain HTML page</p>
      {error && <p style={{ color: 'red' }}>Could not load events: {error}</p>}
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Type</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Updated</th>
            <th>History</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.event_id}>
              <td>{e.event_id}</td>
              <td>{e.type}</td>
              <td>{e.status}</td>
              <td>
                {e.attempt_count} / {e.max_attempts}
              </td>
              <td>{formatDateTime(e.updated_at)}</td>
              <td>
                <details>
                  <summary>{e.attempts.length} attempt(s)</summary>
                  <table border={1} cellPadding={4}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Worker</th>
                        <th>Started</th>
                        <th>Finished</th>
                        <th>Result</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.attempts.map((a) => (
                        <tr key={a.attempt_number}>
                          <td>{a.attempt_number}</td>
                          <td>{a.worker_id}</td>
                          <td>{formatDateTime(a.started_at)}</td>
                          <td>{a.finished_at ? formatDateTime(a.finished_at) : '—'}</td>
                          <td>{a.result}</td>
                          <td>{a.error ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </td>
              <td>
                {e.status === 'permanently_failed' && (
                  <form action={`${API_URL}/events/${e.event_id}/retry`} method="post">
                    <button type="submit">Retry</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  try {
    const res = await fetch(`${API_URL}/events`);
    if (!res.ok) {
      const body = await res.text();
      console.error(`GET ${API_URL}/events -> ${res.status}: ${body}`);
      return { props: { events: [], error: `API returned ${res.status}` } };
    }
    const events = await res.json();
    return { props: { events: Array.isArray(events) ? events : [], error: null } };
  } catch (err) {
    console.error(`Could not reach API at ${API_URL}`, err);
    return { props: { events: [], error: `Could not reach API at ${API_URL}` } };
  }
};