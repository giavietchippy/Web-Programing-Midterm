import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { RoleBadges } from './RoleBadge';
import { badgesFor } from '../webrtc/RoomSession';

// Per-participant menu (room owner / admin only). The server re-checks every command, e.g. an owner cannot kick an admin.
export default function PeerManageModal({ state, session, target, isAdmin, onClose }) {
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(null); // null | 'kick' | 'ban'
  const isSelf = target.peerId === state.myPeerId;
  const targetIsAdmin = target.role === 'admin';
  const isOwnerTarget = badgesFor(state, target.peerId).includes('owner');
  const canRemove = !isSelf && (isAdmin || !targetIsAdmin);

  const act = (fn) => () => { fn(); onClose(); };

  if (step) {
    const ban = step === 'ban';
    return (
      <Modal title={ban ? `Kick and ban ${target.username}` : `Kick ${target.username}`} onClose={onClose}
        footer={<><button className="secondary" onClick={() => setStep(null)}>Back</button><button className="danger" onClick={act(() => session.kick(target.peerId, { ban, reason: reason.trim() || undefined }))}>{ban ? 'Kick and ban' : 'Kick'}</button></>}>
        <p className="muted">{ban ? 'They are removed now and cannot rejoin until the room closes.' : 'They are removed from the call but may rejoin.'}</p>
        <label>Reason (shown to them, optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Repeated disruption" autoFocus /></label>
      </Modal>
    );
  }

  return (
    <Modal title={`Manage ${target.username}${isSelf ? ' (you)' : ''}`} onClose={onClose}>
      <div className="row"><RoleBadges roles={badgesFor(state, target.peerId)} /><span className="muted">{target.role === 'admin' ? 'Site administrator' : 'Participant'}</span></div>
      <div className="menu-list">
        <button className="secondary" disabled={isSelf} onClick={act(() => session.mutePeer(target.peerId, 'audio'))}><Icon name="micOff" size={18} /> Mute audio</button>
        <button className="secondary" disabled={isSelf} onClick={act(() => session.mutePeer(target.peerId, 'video'))}><Icon name="videoOff" size={18} /> Stop camera</button>
        <button className="secondary" disabled={isSelf} onClick={act(() => session.mutePeer(target.peerId, 'screen'))}><Icon name="screen" size={18} /> Stop screen share</button>
        <button className="secondary" disabled={isSelf || isOwnerTarget} onClick={act(() => session.transferOwner(target.peerId))}><Icon name="crown" size={18} /> Make owner</button>
        <button className="danger" disabled={!canRemove} onClick={() => setStep('kick')}><Icon name="leave" size={18} /> Kick</button>
        <button className="danger" disabled={!canRemove} onClick={() => setStep('ban')}><Icon name="ban" size={18} /> Kick and ban</button>
      </div>
      {!isAdmin && targetIsAdmin && <p className="muted small">Room owners cannot kick or ban an administrator.</p>}
      <p className="muted small">Mute, camera and screen buttons send a request; the participant's browser turns its own track off.</p>
    </Modal>
  );
}
