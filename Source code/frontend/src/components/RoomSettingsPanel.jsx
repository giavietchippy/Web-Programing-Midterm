import { useEffect, useState } from 'react';
import Icon from './Icon';

// Room settings (owner / admin only) -> `update-settings`. Only the changed fields are sent; the server validates
// them and answers with `room-state` (or INVALID_SETTING).
export default function RoomSettingsPanel({ state, session, onEndRoom }) {
  const cur = state.settings || { maxPeers: 4, locked: false, chatEnabled: true, screenShare: 'everyone' };
  const [form, setForm] = useState(cur);
  useEffect(() => { setForm(cur); }, [cur.maxPeers, cur.locked, cur.chatEnabled, cur.screenShare]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = {};
  if (Number(form.maxPeers) !== cur.maxPeers) changed.maxPeers = Number(form.maxPeers);
  ['locked', 'chatEnabled', 'screenShare'].forEach((k) => { if (form[k] !== cur[k]) changed[k] = form[k]; });
  const dirty = Object.keys(changed).length > 0;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    if (!Number.isInteger(changed.maxPeers ?? cur.maxPeers)) return session?.notify('error', 'Participant limit must be a whole number.');
    session?.updateSettings(changed);
  };

  return (
    <div className="panel-col pad">
      <h4>Room settings</h4>
      <form onSubmit={submit}>
        <label>Participant limit
          <input type="number" min="1" max="100" step="1" value={form.maxPeers} onChange={(e) => set('maxPeers', e.target.value)} />
          <span className="hint">Lowering it never removes anyone; it only blocks new joins.</span>
        </label>
        <label className="check"><input type="checkbox" checked={!!form.locked} onChange={(e) => set('locked', e.target.checked)} />Lock room (no new participants, owner and admins can still join)</label>
        <label className="check"><input type="checkbox" checked={!!form.chatEnabled} onChange={(e) => set('chatEnabled', e.target.checked)} />Chat enabled</label>
        <label>Screen sharing
          <select value={form.screenShare} onChange={(e) => set('screenShare', e.target.value)}>
            <option value="everyone">Everyone</option>
            <option value="owner">Owner only</option>
          </select>
        </label>
        <div className="row"><button disabled={!dirty || state.status !== 'connected'}>Apply settings</button><button type="button" className="secondary" disabled={!dirty} onClick={() => setForm(cur)}>Reset</button></div>
      </form>

      <h4 style={{ marginTop: 18 }}>Moderation</h4>
      <div className="menu-list">
        <button className="secondary" onClick={() => session?.muteAll('audio')}><Icon name="micOff" size={18} /> Mute everyone</button>
        <button className="secondary" onClick={() => session?.muteAll('video')}><Icon name="videoOff" size={18} /> Stop all cameras</button>
        <button className="secondary" onClick={() => session?.muteAll('screen')}><Icon name="screen" size={18} /> Stop all screen shares</button>
      </div>
      <h4 style={{ marginTop: 18 }}>End the meeting</h4>
      <button className="danger" onClick={onEndRoom}><Icon name="leave" size={18} /> End room for everyone</button>
    </div>
  );
}
