import { useState } from 'react';
import Icon from './Icon';
import { RoleBadges } from './RoleBadge';
import PeerManageModal from './PeerManageModal';
import { badgesFor, deriveRoles } from '../webrtc/RoomSession';

export default function PeoplePanel({ state, session, myName }) {
  const { isAdmin, canManage } = deriveRoles(state);
  const [target, setTarget] = useState(null);
  const rows = state.roster.length ? state.roster : [{ peerId: state.myPeerId, username: myName, role: state.myRole }];

  const mediaOf = (r) => {
    if (r.peerId === state.myPeerId) return { cam: state.camOn, mic: state.micOn, screen: !!state.localScreen };
    const p = state.peers[r.peerId];
    return { cam: p?.camera?.active !== false && !!p, mic: p?.microphone?.active !== false && !!p, screen: !!p?.screen?.active };
  };

  return (
    <div className="panel-col">
      <div className="pad">
        <h4>People ({rows.length})</h4>
        {!canManage && <p className="muted small">Only the room owner and administrators can manage participants.</p>}
      </div>
      <ul className="people">
        {rows.map((r) => {
          const m = mediaOf(r);
          const me = r.peerId === state.myPeerId;
          return (
            <li key={r.peerId}>
              <i className="avatar-sm">{(r.username || '?').charAt(0).toUpperCase()}</i>
              <span className="who"><b>{r.username}{me ? ' (You)' : ''}</b><span><RoleBadges roles={badgesFor(state, r.peerId)} /></span></span>
              <span className="media-ico" title="Microphone"><Icon name={m.mic ? 'mic' : 'micOff'} size={16} /></span>
              <span className="media-ico" title="Camera"><Icon name={m.cam ? 'video' : 'videoOff'} size={16} /></span>
              {m.screen && <span className="media-ico on" title="Sharing screen"><Icon name="screen" size={16} /></span>}
              {canManage && !me && <button className="secondary icon-btn" onClick={() => setTarget(r)} aria-label={`Manage ${r.username}`}><Icon name="more" size={16} /></button>}
            </li>
          );
        })}
      </ul>
      {target && <PeerManageModal state={state} session={session} target={target} isAdmin={isAdmin} onClose={() => setTarget(null)} />}
    </div>
  );
}
