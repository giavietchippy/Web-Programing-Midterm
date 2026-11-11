import Icon from '../components/Icon';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isMock } from '../api';
import { validateCredentials } from '../api/endpoints';

export default function AuthPage({ mode }) {
  const isLogin = mode === 'login';
  const { signIn, signUp } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState(isLogin && isMock ? 'demo' : '');
  const [password, setPassword] = useState(isLogin && isMock ? 'demo123' : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!isLogin) { const bad = validateCredentials(username.trim(), password); if (bad) return setErr(bad); }
    setBusy(true);
    try {
      await (isLogin ? signIn(username.trim(), password) : signUp(username.trim(), password));
      nav('/', { replace: true });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <div className="auth-wrap">
      <div className="auth-hero">
        <div className="brand"><span className="brand-mark"><Icon name="video" size={20} /></span>WebRTC Meet</div>
        <h2>Meet face to face, right in your browser.</h2>
        <p>Video, chat and file sharing travel directly between participants. No installs, no plugins.</p>
        <div className="chips">
          <span className="chip"><Icon name="lock" size={15} /> Encrypted media</span>
          <span className="chip"><Icon name="chat" size={15} /> Chat &amp; files</span>
          <span className="chip"><Icon name="screen" size={15} /> Screen sharing</span>
        </div>
      </div>
      <form className="card auth" onSubmit={submit}>
        <h1>{isLogin ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{isLogin ? 'Log in to start or join a room.' : 'It takes a few seconds.'}</p>
        {isMock && <div className="banner info">Mock REST mode: use <code>demo / demo123</code>. Register creates a local fake account (username 3-32 chars, password 8-72 bytes).</div>}
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="banner error">{err}</div>}
        <button disabled={busy}>{busy ? 'Please wait…' : isLogin ? 'Log in' : 'Register'}</button>
        <p className="muted">
          {isLogin ? <>No account? <Link to="/register">Register</Link></> : <>Have an account? <Link to="/login">Log in</Link></>}
        </p>
      </form>
      </div>
    </div>
  );
}
