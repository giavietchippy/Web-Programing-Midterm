import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { adminApi } from '../../api/admin';
import { ErrorBox, PageHead, useLoad, useToast } from '../../admin/ui';

const NUM = [
  ['maxPeersPerRoom', 'Max peers per room', '1 to 100. Lowering it caps existing rooms but never evicts anyone.', 1, 100],
  ['maxRooms', 'Max rooms', '1 to 10 000. Creating more rooms returns MAX_ROOMS_REACHED.', 1, 10000],
  ['maxConnectionsPerUser', 'Connections per user', '1 to 100. More sockets closes with TOO_MANY_CONNECTIONS.', 1, 100],
  ['rateLimit', 'Rate limit (messages / second)', '1 to 10 000 per connection. Exceeding it closes with RATE_LIMITED.', 1, 10000]
];

export default function Config() {
  const { data, error, loading, reload } = useLoad(() => adminApi.getConfig(), []);
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(null);
  const [formErr, setFormErr] = useState('');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setCfg(data); setSaved(data); } }, [data]);

  if (!cfg) return <><PageHead title="Limits & config" /><ErrorBox error={error} onRetry={reload} />{loading && <p className="muted">Loading…</p>}</>;

  const d = cfg.defaultRoomSettings;
  const setNum = (k, v) => setCfg({ ...cfg, [k]: v });
  const setDef = (k, v) => setCfg({ ...cfg, defaultRoomSettings: { ...d, [k]: v } });

  // send only what changed (PUT /admin/config accepts a partial object)
  const patch = {};
  NUM.forEach(([k]) => { if (Number(cfg[k]) !== saved[k]) patch[k] = Number(cfg[k]); });
  const defPatch = {};
  Object.keys(d).forEach((k) => { const v = k === 'maxPeers' ? Number(d[k]) : d[k]; if (v !== saved.defaultRoomSettings[k]) defPatch[k] = v; });
  if (Object.keys(defPatch).length) patch.defaultRoomSettings = defPatch;
  const dirty = Object.keys(patch).length > 0;

  const save = async (e) => {
    e.preventDefault();
    setFormErr('');
    const nonInt = NUM.find(([k]) => k in patch && !Number.isInteger(patch[k]));
    if (nonInt) return setFormErr(`${nonInt[1]} must be a whole number.`);
    setBusy(true);
    try {
      const next = await adminApi.updateConfig(patch);
      setCfg(next); setSaved(next);
      toast('ok', 'Configuration saved. The real-time server persists it.');
    } catch (err) { setFormErr(`${err.code === 'INVALID_SETTING' ? 'Invalid setting: ' : ''}${err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Limits & config" subtitle="Global limits of the real-time server. Changes apply immediately and are persisted.">
        <button className="secondary" onClick={() => reload()}><Icon name="refresh" size={16} /> Reload</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      <form onSubmit={save}>
        <div className="two-col">
          <section className="card">
            <h3>Global limits</h3>
            {NUM.map(([k, label, hint, min, max]) => (
              <label key={k}>{label}
                <input type="number" min={min} max={max} step="1" value={cfg[k]} onChange={(e) => setNum(k, e.target.value)} />
                <span className="hint">{hint}</span>
              </label>
            ))}
          </section>
          <section className="card">
            <h3>Defaults for new rooms</h3>
            <label>Participant limit
              <input type="number" min="1" max={cfg.maxPeersPerRoom} step="1" value={d.maxPeers} onChange={(e) => setDef('maxPeers', e.target.value)} />
              <span className="hint">Cannot exceed “Max peers per room”.</span>
            </label>
            <label className="check"><input type="checkbox" checked={!!d.locked} onChange={(e) => setDef('locked', e.target.checked)} />Locked by default</label>
            <label className="check"><input type="checkbox" checked={!!d.chatEnabled} onChange={(e) => setDef('chatEnabled', e.target.checked)} />Chat enabled</label>
            <label>Screen sharing
              <select value={d.screenShare} onChange={(e) => setDef('screenShare', e.target.value)}><option value="everyone">Everyone</option><option value="owner">Owner only</option></select>
            </label>
          </section>
        </div>
        {formErr && <div className="banner error"><span><Icon name="alert" size={16} /> {formErr}</span></div>}
        <div className="row"><button disabled={!dirty || busy}>Save changes</button><button type="button" className="secondary" disabled={!dirty} onClick={() => { setCfg(saved); setFormErr(''); }}>Discard</button>{dirty && <span className="muted small">Unsaved: {Object.keys(patch).join(', ')}</span>}</div>
      </form>
    </>
  );
}
