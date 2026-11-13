import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useAuth } from '../../context/AuthContext';
import { isMockAdmin } from '../../api/admin';
import { AdminFeedProvider, useFeed } from '../../admin/feed';
import { ToastProvider } from '../../admin/ui';

const NAV = [
  ['/admin', 'dashboard', 'Dashboard', true],
  ['/admin/rooms', 'door', 'Rooms'],
  ['/admin/users', 'users', 'Users'],
  ['/admin/connections', 'plug', 'Connections'],
  ['/admin/config', 'settings', 'Limits & config'],
  ['/admin/audit', 'list', 'Audit log'],
  ['/admin/announcements', 'megaphone', 'Announcements']
];

const FEED_TEXT = { live: 'Live feed connected', connecting: 'Connecting to live feed…', down: 'Live feed offline (polling)' };

function FeedPill() {
  const { status } = useFeed();
  const { closeCode } = useFeed();
  const text = status === 'down' && closeCode ? `Live feed closed (${closeCode})` : FEED_TEXT[status];
  return <span className={`pill ${status === 'live' ? 'connected' : status === 'down' ? 'closed' : 'connecting'}`}>{text}</span>;
}

// Shown when the live feed was closed on purpose by the server (4001/4002/4003/4006...).
// The feed does NOT reconnect by itself in these cases, so the banner explains why and what to do.
function FeedCloseBanner({ signOut }) {
  const { status, closeCode, closeMessage } = useFeed();
  if (status !== 'down' || !closeMessage) return null;
  const needsLogin = closeCode === 4001 || closeCode === 4002;
  return (
    <div className="banner error" role="alert">
      <span><Icon name="alert" size={16} /> {closeMessage} <span className="muted small">(code {closeCode}; the live feed will not reconnect automatically, pages keep refreshing by polling)</span></span>
      {needsLogin && <button onClick={signOut}>Log in again</button>}
    </div>
  );
}

export default function AdminLayout() {
  const { auth, signOut } = useAuth();
  const nav = useNavigate();
  return (
    <ToastProvider>
      <AdminFeedProvider>
        <div className="page admin">
          <header className="topbar">
            <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}><span className="brand-mark"><Icon name="video" size={20} /></span>WebRTC Meet</Link>
            <span className="role-badge admin big"><Icon name="shield" size={13} /> Administrator</span>
            <FeedPill />
            <span className="grow" />
            <button className="secondary" onClick={() => nav('/')}><Icon name="arrowLeft" size={16} /> Back to app</button>
            <span className="user-chip"><i>{(auth.username || '?').charAt(0).toUpperCase()}</i>{auth.username}</span>
            <button className="secondary" onClick={signOut}>Log out</button>
          </header>
          <div className="admin-body">
            <nav className="admin-nav card" aria-label="Administrator sections">
              {NAV.map(([to, icon, text, end]) => (
                <NavLink key={to} to={to} end={!!end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}><Icon name={icon} size={18} />{text}</NavLink>
              ))}
            </nav>
            <main className="admin-main">
              {isMockAdmin && <div className="banner info">Mock admin mode is ON: rooms, connections, config, audit and users below are fake data (set <code>USE_MOCK_ADMIN=false</code> to use the real servers).</div>}
              <FeedCloseBanner signOut={signOut} />
              <Outlet />
            </main>
          </div>
        </div>
      </AdminFeedProvider>
    </ToastProvider>
  );
}
