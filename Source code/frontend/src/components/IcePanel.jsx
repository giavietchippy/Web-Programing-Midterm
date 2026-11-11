import { useMemo, useState } from 'react';

export default function IcePanel({ state }) {
  const [filter, setFilter] = useState('all');
  const cats = useMemo(() => ['all', ...new Set(state.iceLog.map((l) => l.cat))], [state.iceLog]);
  const rows = state.iceLog.filter((l) => filter === 'all' || l.cat === filter);
  const copy = () => navigator.clipboard?.writeText(rows.map((l) => `${l.t} [${l.cat}] ${l.peer} ${l.msg}`).join('\n'));

  return (
    <div className="panel-col">
      <div className="pad">
        <div className="kv">
          <span>ICE policy</span><b className={state.forceRelay ? 'warn' : 'ok'}>{state.forceRelay ? 'relay only (TURN forced)' : 'all (host + STUN + TURN)'}</b>
          <span>ICE servers</span><b className="wrap">{state.iceUrls.join(', ') || '–'}</b>
        </div>
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="secondary" onClick={copy}>Copy log</button>
        </div>
      </div>
      <div className="log">
        {rows.length === 0 && <p className="muted pad">No events yet.</p>}
        {rows.map((l) => (
          <div key={l.id} className="log-row">
            <span className="muted">{l.t}</span> <span className={`cat c-${l.cat}`}>{l.cat}</span> <span className="muted">{String(l.peer).slice(0, 6)}</span> {l.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
