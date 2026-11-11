import Icon from './Icon';

export default function ControlsBar({ state, session, tab, panelOpen, setTab, setPanelOpen, onLeave }) {
  const sharing = !!state.localScreen;
  const hasAudio = !!state.localCamera?.getAudioTracks().length;
  const toggleTab = (t) => {
    if (panelOpen && tab === t) setPanelOpen(false);
    else { setTab(t); setPanelOpen(true); }
  };
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
      <button className={sharing ? 'active' : ''} onClick={() => session?.toggleScreen()}>
        <span className="ico"><Icon name="screen" size={26} /></span>
        <span>{sharing ? 'Stop sharing' : 'Share screen'}</span>
      </button>
      <span className="sep" />
      {[['chat', 'chat', 'Chat'], ['files', 'clip', 'Files'], ['stats', 'chart', 'Stats'], ['ice', 'network', 'ICE debug']].map(([id, icon, text]) => (
        <button key={id} className={`secondary${panelOpen && tab === id ? ' active' : ''}`} onClick={() => toggleTab(id)}>
          <span className="ico"><Icon name={icon} size={26} /></span>
          <span>{text}</span>
        </button>
      ))}
      <span className="sep" />
      <button className="danger" onClick={onLeave}>
        <span className="ico"><Icon name="leave" size={26} /></span>
        <span>Leave</span>
      </button>
    </div>
  );
}
