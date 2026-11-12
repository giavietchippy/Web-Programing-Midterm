import { useState } from 'react';
import Modal from '../Modal';
import { adminApi } from '../../api/admin';
import { ConfirmModal, useAction } from '../../admin/ui';

/** PATCH /admin/rooms/:id/settings with only the changed fields. */
export function RoomSettingsModal({ room, onClose, onDone }) {
  const cur = room.settings;
  const [form, setForm] = useState({ ...cur });
  const { run, busy } = useAction();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const changed = {};
  if (Number(form.maxPeers) !== cur.maxPeers) changed.maxPeers = Number(form.maxPeers);
  ['locked', 'chatEnabled', 'screenShare'].forEach((k) => { if (form[k] !== cur[k]) changed[k] = form[k]; });
  const save = async () => { if (await run(() => adminApi.updateRoomSettings(room.id, changed), 'Room settings updated.')) { onDone?.(); onClose(); } };
  return (
    <Modal title={`Settings: ${room.id}`} onClose={onClose}
      footer={<><button className="secondary" onClick={onClose}>Cancel</button><button disabled={busy || !Object.keys(changed).length} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <label>Participant limit<input type="number" min="1" max="100" value={form.maxPeers} onChange={(e) => set('maxPeers', e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={!!form.locked} onChange={(e) => set('locked', e.target.checked)} />Locked (non-owner, non-admin joins are rejected)</label>
      <label className="check"><input type="checkbox" checked={!!form.chatEnabled} onChange={(e) => set('chatEnabled', e.target.checked)} />Chat enabled</label>
      <label>Screen sharing
        <select value={form.screenShare} onChange={(e) => set('screenShare', e.target.value)}><option value="everyone">Everyone</option><option value="owner">Owner only</option></select>
      </label>
    </Modal>
  );
}

/** POST /admin/announce, to one room (room set) or to every room. */
export function AnnounceModal({ room, onClose, onDone }) {
  const [text, setText] = useState('');
  const { run, busy } = useAction();
  const send = async () => { if (await run(() => adminApi.announce({ text: text.trim(), room }), room ? `Announcement sent to ${room}.` : 'Announcement sent to all rooms.')) { onDone?.(); onClose(); } };
  return (
    <Modal title={room ? `Announce in ${room}` : 'Announce to all rooms'} onClose={onClose}
      footer={<><button className="secondary" onClick={onClose}>Cancel</button><button disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button></>}>
      <label>Message<textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Shown to everyone in the room as a notification" autoFocus /></label>
      <p className="muted small">{text.length} / 4000</p>
    </Modal>
  );
}

/** POST /admin/rooms/:id/close */
export function CloseRoomModal({ room, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  const go = async () => { if (await run(() => adminApi.closeRoom(room, reason.trim() || undefined), `Room ${room} closed.`)) { onDone?.(); onClose(); } };
  return (
    <ConfirmModal title={`Close room ${room}?`} confirmText="Close room" busy={busy} onConfirm={go} onClose={onClose}>
      <p className="muted">Everyone inside is disconnected and receives <code>room-closed</code>.</p>
      <label>Reason shown to participants (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Closed by an administrator" autoFocus /></label>
    </ConfirmModal>
  );
}
