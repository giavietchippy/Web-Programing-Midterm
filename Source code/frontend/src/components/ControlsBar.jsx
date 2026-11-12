import Icon from './Icon';
import { deriveRoles } from '../webrtc/RoomSession';

export default function ControlsBar({ state, session, tab, panelOpen, setTab, setPanelOpen, onLeave, onEndRoom }) {
  const sharing = !!state.localScreen;
  const hasAudio = !!state.localCamera?.getAudioTracks().length;
  const { canManage } = deriveRoles(state);
  const shareBlocked = state.settings?.screenShare === 'owner' && !canManage && !sharing; // convenience only: the server enforces it
  const toggleTab = (t) => {
    if (panelOpen && tab === t) setPanelOpen(false);
    else { setTab(t); setPanelOpen(true); }
  };
  const tabs = [['chat', 'chat', 'Chat'], ['people', 'users', 'People'], ...(canManage ? [['room', 'settings', 'Room']] : []), ['files', 'clip', 'Files'], ['stats', 'chart', 'Stats'], ['ice', 'network', 'ICE debug']];
  return (
    <div className="controls">
      <button className={state.micOn ? '' : 'off'} disabled={!hasAudio} onClick={() => session?.toggleMic()}>
        <span className="ico"><Icon name={state.micOn ? 'mic' : 'micOff'} size={26} /></span>
        <span>{state.micOn ? 'Mute' : 'Unmute'}</span>
      </button>
      <button className={state.camOn ? '' : 'off'} onClick={() => session?.toggleCam()}>
        <span className="ico"><Icon name={state.camOn ? 'video' : 'videoOff'} size={26} /></span>
        <span>{state.camOn ? 'Camera off' : 'Camera on'}</span>
      </button>
      <button className={sharing ? 'active' : ''} disabled={shareBlocked} title={shareBlocked ? 'Only the room owner or an admin can share their screen in this room.' : undefined} onClick={() => session?.toggleScreen()}>
        <span className="ico"><Icon name="screen" size={26} /></span>
        <span>{sharing ? 'Stop sharing' : 'Share screen'}</span>
      </button>
      <span className="sep" />
      {tabs.map(([id, icon, text]) => (
        <button key={id} className={`secondary${panelOpen && tab === id ? ' active' : ''}`} onClick={() => toggleTab(id)}>
          <span className="ico"><Icon name={icon} size={26} /></span>
          <span>{text}</span>
        </button>
      ))}
      {canManage && (
        <>
          <span className="sep" />
          <button className="secondary" onClick={() => session?.muteAll('audio')} title="Ask everyone else to mute their microphone">
            <span className="ico"><Icon name="micOff" size={26} /></span>
            <span>Mute all</span>
          </button>
          <button className="danger" onClick={onEndRoom} title="Close the room for everyone">
            <span className="ico"><Icon name="ban" size={26} /></span>
            <span>End room</span>
          </button>
        </>
      )}
      <span className="sep" />
      <button className="danger" onClick={onLeave}>
        <span className="ico"><Icon name="leave" size={26} /></span>
        <span>Leave</span>
      </button>
    </div>
  );
}
