import Icon from './Icon';
import { useRef } from 'react';
import { bytes } from '../utils/format';

export default function FilesPanel({ state, session }) {
  const input = useRef(null);
  const openPeers = Object.values(state.peers).filter((p) => p.dcOpen).length;
  const onPick = (e) => {
    [...e.target.files].forEach((f) => session?.sendFile(f));
    e.target.value = '';
  };
  return (
    <div className="panel-col pad">
      <p className="muted">Files travel directly between browsers over the RTCDataChannel (16 KB chunks, back-pressure controlled). Nothing is uploaded to a server.</p>
      <input ref={input} type="file" multiple hidden onChange={onPick} />
      <button disabled={!openPeers} onClick={() => input.current?.click()}>Send file to {openPeers} peer(s)</button>
      <div className="transfers">
        {state.transfers.length === 0 && <p className="muted">No transfers yet.</p>}
        {state.transfers.map((t) => (
          <div key={t.key} className="transfer">
            <div><b><Icon name={t.direction === 'out' ? 'up' : 'down'} size={14} /> {t.name}</b> <span className="muted">{bytes(t.size)} · {state.peers[t.peerId]?.username || t.peerId}</span></div>
            <div className="bar"><div style={{ width: `${Math.round((t.progress || 0) * 100)}%` }} /></div>
            <div className="muted">
              {t.status}
              {t.status === 'done' && t.url && <> · <a href={t.url} download={t.name}>Download</a></>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
