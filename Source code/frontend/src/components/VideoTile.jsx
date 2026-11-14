import Icon from './Icon';
import { RoleBadges } from './RoleBadge';
import { useEffect, useRef, useState } from 'react';

// srcObject is attached in an effect (never during render) and the <video> element is
// ALWAYS mounted with an explicit 16:9 box, so a late/missing stream can never collapse the layout.
// onToggleFocus: enlarge this tile into the main area (parent decides the layout). Full screen is handled here.
// sinkId: chosen speaker ('' = system default) - applied with setSinkId where the browser supports it.
export default function VideoTile({ stream, label, muted = false, mirror = false, screen = false, off = false, badge, roles = [], onManage, onToggleFocus, focused = false, sinkId = '' }) {
  const ref = useRef(null);
  const tileRef = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const canFs = !!stream && typeof document !== 'undefined' && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  useEffect(() => {
    const sync = () => setIsFs((document.fullscreenElement || document.webkitFullscreenElement) === tileRef.current);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggleFullscreen = () => {
    const el = tileRef.current;
    if (!el) return;
    if (isFs) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    p?.catch?.(() => {});
  };

  // Route this element's audio to the selected output device. Local and screen tiles are muted, so skip them.
  useEffect(() => {
    const v = ref.current;
    if (!v || muted || screen || typeof v.setSinkId !== 'function') return;
    v.setSinkId(sinkId || '').catch((e) => console.warn('[audio] setSinkId failed:', e?.message || e));
  }, [sinkId, muted, screen]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream || null;
    if (!stream) { setBlocked(false); return; }

    let active = true;
    const play = () => {
      const p = v.play?.();
      if (p?.then) p.then(() => { if (active) setBlocked(false); })
        .catch((e) => { if (active && e?.name !== 'AbortError') setBlocked(true); });
    };
    // A remote video track may arrive in a muted state, then unmute once
    // ICE connects and frames begin. Retry playback at that point.
    const tracks = stream.getVideoTracks();
    tracks.forEach((track) => track.addEventListener('unmute', play));
    v.addEventListener('loadedmetadata', play);
    play();
    return () => {
      active = false;
      tracks.forEach((track) => track.removeEventListener('unmute', play));
      v.removeEventListener('loadedmetadata', play);
    };
  }, [stream]);

  const initial = (label || '?').trim().charAt(0).toUpperCase();
  const hue = [...(label || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const avatarStyle = { background: `linear-gradient(135deg, hsl(${hue} 85% 58%), hsl(${(hue + 40) % 360} 90% 62%))` };
  return (
    <div ref={tileRef} className={`tile${screen ? ' screen' : ''}${focused ? ' focused' : ''}`}
      onDoubleClick={(e) => { if (stream && onToggleFocus && !e.target.closest('button')) onToggleFocus(); }}>
      <video ref={ref} autoPlay playsInline muted={muted || screen} className={mirror ? 'mirror' : ''} style={{ visibility: off ? 'hidden' : 'visible' }} />
      {off && <div className="avatar"><span style={avatarStyle}>{initial}</span></div>}
      {blocked && <button className="play-btn" onClick={() => ref.current?.play().then(() => setBlocked(false)).catch(() => {})}><Icon name="play" size={14} /> Click to play</button>}
      <div className="tile-actions">
        {stream && onToggleFocus && (
          <button className="tile-btn" onClick={onToggleFocus} title={focused ? 'Back to grid' : 'Enlarge (double-click)'} aria-label={focused ? 'Back to grid' : `Enlarge ${label}`}>
            <Icon name={focused ? 'shrink' : 'expand'} size={18} />
          </button>
        )}
        {canFs && (
          <button className="tile-btn" onClick={toggleFullscreen} title={isFs ? 'Exit full screen' : 'Full screen'} aria-label={isFs ? 'Exit full screen' : `Full screen ${label}`}>
            <Icon name={isFs ? 'fullscreenExit' : 'fullscreen'} size={18} />
          </button>
        )}
        {onManage && <button className="tile-btn" onClick={onManage} title={`Manage ${label}`} aria-label={`Manage ${label}`}><Icon name="more" size={18} /></button>}
      </div>
      <div className="tile-label">{label}<RoleBadges roles={roles} />{badge && <em>{badge}</em>}</div>
    </div>
  );
}
