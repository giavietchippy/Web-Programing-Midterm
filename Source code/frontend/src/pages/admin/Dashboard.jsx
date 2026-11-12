import Icon from '../../components/Icon';
import { api } from '../../api';
import { adminApi } from '../../api/admin';
import { useFeed } from '../../admin/feed';
import { ErrorBox, LineChart, PageHead, duration, useLoad } from '../../admin/ui';

const Kpi = ({ icon, label, value, sub }) => (
  <div className="kpi card">
    <span className="kpi-ico"><Icon name={icon} size={20} /></span>
    <div><div className="kpi-val">{value ?? '–'}</div><div className="kpi-label">{label}</div>{sub && <div className="muted small">{sub}</div>}</div>
  </div>
);

export default function Dashboard() {
  const feed = useFeed();
  const live = feed.status === 'live';
  // GET /admin/stats gives the first numbers and keeps polling when the live feed is down.
  const rt = useLoad(() => adminApi.getStats(), [], { interval: live ? 0 : 5000 });
  const platform = useLoad(() => api.getAdminStats().catch(() => null), [], { interval: 15000 });
  const s = feed.stats || rt.data;
  const errors = Object.entries(s?.errorsByCode || {}).sort((a, b) => b[1] - a[1]);
  const maxErr = Math.max(1, ...errors.map(([, n]) => n));
  const h = feed.history;

  return (
    <>
      <PageHead title="Dashboard" subtitle="Real-time server health. Numbers refresh every 2 seconds from the live feed.">
        <button className="secondary" onClick={() => { rt.reload(); platform.reload(); }}><Icon name="refresh" size={16} /> Refresh</button>
      </PageHead>
      {!s && <ErrorBox error={rt.error} onRetry={rt.reload} />}
      {!s && !rt.error && <p className="muted">Loading…</p>}
      {s && (
        <>
          <div className="kpis">
            <Kpi icon="plug" label="Live connections" value={s.connections} sub={`peak ${s.peakConnections}`} />
            <Kpi icon="door" label="Rooms" value={s.rooms} />
            <Kpi icon="users" label="Peers in rooms" value={s.peers} />
            <Kpi icon="chart" label="Messages / second" value={s.messagesPerSecond} sub="client messages, last second" />
            <Kpi icon="refresh" label="Uptime" value={duration(s.uptime)} />
          </div>

          <section className="card">
            <h3>Traffic over the last {Math.max(1, Math.round((h.length * 2) / 60))} min</h3>
            {h.length < 2 ? <p className="muted">Collecting live points…</p> : (
              <LineChart series={[
                { label: 'Messages / s', color: '#1f6fff', data: h.map((p) => p.messagesPerSecond) },
                { label: 'Connections', color: '#ff7a45', data: h.map((p) => p.connections) },
                { label: 'Peers', color: '#14a65a', data: h.map((p) => p.peers) }
              ]} />
            )}
          </section>

          <div className="two-col">
            <section className="card">
              <h3>Errors by code</h3>
              {errors.length === 0 ? <p className="muted">No errors since the server started.</p> : (
                <ul className="bars">
                  {errors.map(([code, n]) => (
                    <li key={code}><code>{code}</code><span className="bar"><div style={{ width: `${(n / maxErr) * 100}%` }} /></span><b>{n}</b></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h3>Platform (REST)</h3>
              {platform.data ? (
                <div className="kv">
                  <span>Users</span><b>{platform.data.users?.total ?? '–'}</b>
                  <span>Rooms (database)</span><b>{platform.data.rooms?.total ?? '–'}</b>
                  <span>Stored messages</span><b>{platform.data.messages?.total ?? '–'}</b>
                  <span>Generated</span><b>{platform.data.generatedAt ? new Date(platform.data.generatedAt).toLocaleTimeString('en-GB') : '–'}</b>
                </div>
              ) : <p className="muted">{platform.loading ? 'Loading…' : 'Platform statistics are unavailable.'}</p>}
            </section>
          </div>
        </>
      )}
    </>
  );
}
