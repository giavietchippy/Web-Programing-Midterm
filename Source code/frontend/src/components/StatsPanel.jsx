import Icon from './Icon';
import { fmt } from '../utils/format';

function Spark({ data, color }) {
  const w = 220, h = 36;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export default function StatsPanel({ state }) {
  const peers = Object.values(state.peers);
  return (
    <div className="panel-col pad">
      <p className="muted">Live <code>RTCPeerConnection.getStats()</code> sampled every second.</p>
      {peers.length === 0 && <p className="muted">Waiting for a peer…</p>}
      {peers.map((p) => {
        const st = state.stats[p.peerId];
        const s = st?.latest;
        return (
          <div key={p.peerId} className="card">
            <h4>{p.username} <span className={`pill ${p.connectionState}`}>{p.connectionState}</span></h4>
            {!s ? <p className="muted">No stats yet…</p> : (
              <>
                <div className="kv">
                  <span>Path</span><b className={s.relay ? 'warn' : 'ok'}>{s.relay ? 'TURN relay' : 'direct (host/STUN)'}</b>
                  <span>Candidates</span><b>{s.localType || '–'} ↔ {s.remoteType || '–'} ({s.protocol || '–'})</b>
                  <span>RTT</span><b>{fmt(s.rttMs, 0)} ms</b>
                  <span>Jitter</span><b>{fmt(s.jitterMs, 1)} ms</b>
                  <span>Packet loss</span><b>{fmt(s.lossPct, 2)} %</b>
                  <span>Video</span><b>{s.resolution || '–'} @ {fmt(s.fps, 0)} fps</b>
                  <span>Codec</span><b>{s.codec || '–'}</b>
                  <span>Security</span><b>DTLS {s.dtls || '–'}{s.srtp ? ` · SRTP ${s.srtp}` : ''}</b>
                </div>
                <div className="spark-row"><span><Icon name="down" size={14} /> {fmt(s.inKbps, 0)} kbps</span><Spark data={st.history.map((x) => x.inKbps)} color="#14a65a" /></div>
                <div className="spark-row"><span><Icon name="up" size={14} /> {fmt(s.outKbps, 0)} kbps</span><Spark data={st.history.map((x) => x.outKbps)} color="#1f6fff" /></div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
