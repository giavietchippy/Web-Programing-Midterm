import { useState } from 'react';
import Icon from '../../components/Icon';
import { adminApi } from '../../api/admin';
import { ErrorBox, PageHead, useAction, useLoad } from '../../admin/ui';

// POST /admin/announce { text, room? }. Without `room` it goes to every room; participants see it as a notification.
export default function Announcements() {
  const rooms = useLoad(() => adminApi.listRooms(), []);
  const [text, setText] = useState('');
  const [room, setRoom] = useState('');
  const [sent, setSent] = useState([]);
  const { run, busy } = useAction();

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    const ok = await run(() => adminApi.announce({ text: body, room: room || undefined }), room ? `Sent to ${room}.` : 'Sent to all rooms.');
    if (ok) { setSent((l) => [{ id: Date.now(), text: body, room, at: new Date() }, ...l].slice(0, 20)); setText(''); }
  };

  return (
    <>
      <PageHead title="Announcements" subtitle="Send a message to everyone currently in a call, or to a single room." />
      <ErrorBox error={rooms.error} onRetry={rooms.reload} />
      <div className="two-col">
        <form className="card" onSubmit={send}>
          <h3>New announcement</h3>
          <label>Send to
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">All rooms ({rooms.data?.length ?? 0})</option>
              {(rooms.data || []).map((r) => <option key={r.id} value={r.id}>{r.id} ({r.peerCount} in call)</option>)}
            </select>
          </label>
          <label>Message<textarea rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. The server restarts in 10 minutes." /></label>
          <div className="row"><button disabled={busy || !text.trim()}><Icon name="megaphone" size={16} /> {busy ? 'Sending…' : 'Send announcement'}</button><span className="muted small grow">{text.length} / 4000</span><button type="button" className="secondary" onClick={() => rooms.reload()}>Refresh rooms</button></div>
        </form>
        <section className="card">
          <h3>Sent in this session</h3>
          {sent.length === 0 ? <p className="muted">Nothing sent yet. The full history is in the Audit log (action <code>announcement</code>).</p> : (
            <ul className="sent">{sent.map((s) => (
              <li key={s.id}><div className="muted small">{s.at.toLocaleTimeString('en-GB')} → {s.room || 'all rooms'}</div>{s.text}</li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}
