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
    <div className="page">
      <h1>Webhook Events</h1>
      {error && <p className="banner">Could not load events: {error}</p>}
      <table>
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Type</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Updated</th>
            <th>History</th>
            <th>Operations</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.event_id}>
              <td>{e.event_id}</td>
              <td>{e.type}</td>
              <td>
                <span className={`status status-${e.status}`}>{e.status}</span>
              </td>
              <td>
                {e.attempt_count} / {e.max_attempts}
              </td>
              <td>{formatDateTime(e.updated_at)}</td>
              <td>
                <details>
                  <summary>{e.attempts.length} attempt(s)</summary>
                  <table className="nested">
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
                          <td className={`result-${a.result}`}>{a.result}</td>
                          <td>{a.error ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </td>
              <td>
                {e.status === 'permanently_failed' && (
                  <form action={`/api/retry/${e.event_id}`} method="post">
                    <button type="submit">Retry</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <style jsx>{`
        .page {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          padding: 24px;
          color: #1f2937;
        }
        h1 {
          font-size: 20px;
          margin-bottom: 16px;
        }
        .banner {
          background: #fee2e2;
          color: #b91c1c;
          padding: 8px 12px;
          border-radius: 4px;
          display: inline-block;
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th,
        td {
          border: 1px solid #e5e7eb;
          padding: 8px 10px;
          text-align: left;
          font-size: 14px;
          vertical-align: top;
        }
        th {
          background: #f3f4f6;
          font-weight: 600;
        }
        table.nested {
          margin-top: 6px;
          width: auto;
        }
        table.nested th,
        table.nested td {
          font-size: 13px;
          padding: 4px 8px;
        }
        .status {
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
        }
        .status-succeeded {
          background: #dcfce7;
          color: #15803d;
        }
        .status-permanently_failed {
          background: #fee2e2;
          color: #b91c1c;
        }
        .status-pending {
          background: #fef3c7;
          color: #b45309;
        }
        .status-processing {
          background: #dbeafe;
          color: #1d4ed8;
        }
        .result-success {
          color: #15803d;
        }
        .result-failure {
          color: #b91c1c;
        }
        button {
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #93c5fd;
          border-radius: 4px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 13px;
        }
        button:hover {
          background: #dbeafe;
        }
      `}</style>
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