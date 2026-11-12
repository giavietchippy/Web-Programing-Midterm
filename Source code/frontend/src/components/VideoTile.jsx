import Icon from './Icon';
import { RoleBadges } from './RoleBadge';
import { useEffect, useRef, useState } from 'react';

// srcObject is attached in an effect (never during render) and the <video> element is
// ALWAYS mounted with an explicit 16:9 box, so a late/missing stream can never collapse the layout.
export default function VideoTile({ stream, label, muted = false, mirror = false, screen = false, off = false, badge, roles = [], onManage }) {
  const ref = useRef(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream || null;
    if (stream) {
      const p = v.play?.();
      if (p && p.then) p.then(() => setBlocked(false)).catch(() => setBlocked(true)); // autoplay policy
    }
  }, [stream]);

  const initial = (label || '?').trim().charAt(0).toUpperCase();
  const hue = [...(label || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const avatarStyle = { background: `linear-gradient(135deg, hsl(${hue} 85% 58%), hsl(${(hue + 40) % 360} 90% 62%))` };
  return (
    <div className={`tile${screen ? ' screen' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : ''} style={{ visibility: off ? 'hidden' : 'visible' }} />
      {off && <div className="avatar"><span style={avatarStyle}>{initial}</span></div>}
      {blocked && <button className="play-btn" onClick={() => ref.current?.play().then(() => setBlocked(false))}><Icon name="play" size={14} /> Click to play</button>}
      {onManage && <button className="tile-menu" onClick={onManage} title={`Manage ${label}`} aria-label={`Manage ${label}`}><Icon name="more" size={18} /></button>}
      <div className="tile-label">{label}<RoleBadges roles={roles} />{badge && <em>{badge}</em>}</div>
    </div>
  );
}
