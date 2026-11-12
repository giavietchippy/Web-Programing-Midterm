import { useState } from 'react';
import Icon from '../../components/Icon';
import Modal from '../../components/Modal';
import { useAuth } from '../../context/AuthContext';
import { adminApi } from '../../api/admin';
import { RULES, byteLength, validateCredentials } from '../../api/endpoints';
import { ConfirmModal, ErrorBox, PageHead, SORT_ARROW, dateTime, useAction, useDebounced, useLoad, useSort } from '../../admin/ui';

const randomPassword = () => {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint32Array(14));
  return [...buf].map((n) => chars[n % chars.length]).join('');
};

function CreateUserModal({ onClose, onDone }) {
  const [f, setF] = useState({ username: '', password: '', role: 'user' });
  const [err, setErr] = useState('');
  const { run, busy } = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const bad = validateCredentials(f.username.trim(), f.password);
    if (bad) return setErr(bad);
    setErr('');
    if (await run(() => adminApi.createUser({ ...f, username: f.username.trim() }), `User ${f.username.trim()} created.`)) { onDone(); onClose(); }
  };
  return (
    <Modal title="Create user" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Username<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus required /></label>
        <label>Password
          <div className="row" style={{ margin: 0 }}>
            <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
            <button type="button" className="secondary" onClick={() => setF({ ...f, password: randomPassword() })}>Generate</button>
          </div>
        </label>
        <label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="user">user</option><option value="admin">admin</option></select></label>
        {err && <div className="banner error">{err}</div>}
        <div className="modal-foot inline"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }) {
  const [pw, setPw] = useState(randomPassword());
  const [err, setErr] = useState('');
  const { run, busy } = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const n = byteLength(pw);
    if (n < RULES.passwordMinBytes || n > RULES.passwordMaxBytes) return setErr(`Password must be ${RULES.passwordMinBytes} to ${RULES.passwordMaxBytes} bytes.`);
    setErr('');
    if (await run(() => adminApi.resetPassword(user.id, pw), `Password of ${user.username} reset.`)) onClose();
  };
  return (
    <Modal title={`Reset password: ${user.username}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label>New password
          <div className="row" style={{ margin: 0 }}>
            <input value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <button type="button" className="secondary" onClick={() => setPw(randomPassword())}>Generate</button>
            <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(pw)}>Copy</button>
          </div>
        </label>
        <p className="muted small">Give the new password to the user through a safe channel. It is not shown again after you close this window.</p>
        {err && <div className="banner error">{err}</div>}
        <div className="modal-foot inline"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button></div>
      </form>
    </Modal>
  );
}

// ONE button, TWO calls: Member 3 disables the account (/api/admin/users/:id) and
// Member 2 disconnects the live sockets and denies reconnecting (/admin/users/:userId/deny).
function BlockModal({ user, onClose, onDone }) {
  const [minutes, setMinutes] = useState(60);
  const { run, busy } = useAction();
  const go = async () => {
    if (await run(() => adminApi.blockUser(user, Number(minutes)), `${user.username} is blocked and was disconnected.`)) { onDone(); onClose(); }
  };
  return (
    <ConfirmModal title={`Block ${user.username}?`} confirmText="Block now" busy={busy} onConfirm={go} onClose={onClose}>
      <p className="muted">This does two things at once: the account is <b>disabled</b> (cannot log in) and every live connection is <b>disconnected</b> immediately.</p>
      <label>Also deny live reconnects for (minutes)<input type="number" min="1" max="525600" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      <p className="muted small">The account stays disabled until you press Unblock. The reconnect deny only covers sockets that already have a valid token.</p>
    </ConfirmModal>
  );
}

export default function Users() {
  const { auth } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const search = useDebounced(q).trim();
  const { data, error, loading, reload } = useLoad(() => adminApi.listUsers({ search, role }), [search, role]);
  const { run, busy } = useAction();
  const [modal, setModal] = useState(null); // { kind, user }
  const { sort, toggle, apply } = useSort('username');
  const rows = apply(data || [], { username: (u) => u.username.toLowerCase(), created: (u) => new Date(u.createdAt).getTime(), status: (u) => (u.disabled ? 1 : 0) });
  const Th = ({ k, children }) => <th><button className="th-btn" onClick={() => toggle(k)}>{children}{SORT_ARROW(sort.key === k, sort.dir)}</button></th>;
  const me = (u) => u.id === auth.userId;

  const changeRole = (u, next) => run(async () => { await adminApi.updateUser(u.id, { role: next }); reload(true); }, `${u.username} is now ${next}.`);

  return (
    <>
      <PageHead title="Users" subtitle="Accounts from the platform (REST). Blocking also disconnects the user from live rooms.">
        <button className="secondary" onClick={() => reload()}><Icon name="refresh" size={16} /> Refresh</button>
        <button onClick={() => setModal({ kind: 'create' })}><Icon name="plus" size={16} /> Create user</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input placeholder="Search by username or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role"><option value="">All roles</option><option value="user">user</option><option value="admin">admin</option></select>
      </div>
      <div className="card table-card">
        <table className="tbl">
          <thead><tr><Th k="username">Username</Th><th>Role</th><Th k="status">Status</Th><Th k="created">Created</Th><th className="right">Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.disabled ? 'dim' : ''}>
                <td><b>{u.username}</b>{me(u) && <span className="pill connected" style={{ marginLeft: 8 }}>you</span>}<div className="muted small">{u.id}</div></td>
                <td>
                  <select value={u.role} disabled={busy || me(u)} onChange={(e) => changeRole(u, e.target.value)} aria-label={`Role of ${u.username}`}>
                    <option value="user">user</option><option value="admin">admin</option>
                  </select>
                </td>
                <td><span className={`pill ${u.disabled ? 'closed' : 'connected'}`}>{u.disabled ? 'disabled' : 'active'}</span></td>
                <td>{dateTime(u.createdAt)}</td>
                <td className="right actions">
                  {u.disabled
                    ? <button className="secondary" disabled={busy} onClick={() => run(async () => { await adminApi.unblockUser(u); reload(true); }, `${u.username} is enabled again.`)}>Unblock</button>
                    : <button className="secondary" disabled={me(u)} onClick={() => setModal({ kind: 'block', user: u })}><Icon name="ban" size={14} /> Block</button>}
                  <button className="secondary" onClick={() => setModal({ kind: 'reset', user: u })}><Icon name="key" size={14} /> Reset password</button>
                  <button className="danger" disabled={me(u)} onClick={() => setModal({ kind: 'delete', user: u })}><Icon name="trash" size={14} /> Delete</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="5" className="empty-cell">{loading ? 'Loading…' : 'No users found.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {modal?.kind === 'create' && <CreateUserModal onClose={() => setModal(null)} onDone={() => reload(true)} />}
      {modal?.kind === 'reset' && <ResetPasswordModal user={modal.user} onClose={() => setModal(null)} />}
      {modal?.kind === 'block' && <BlockModal user={modal.user} onClose={() => setModal(null)} onDone={() => reload(true)} />}
      {modal?.kind === 'delete' && (
        <ConfirmModal title={`Delete ${modal.user.username}?`} confirmText="Delete user" busy={busy} onClose={() => setModal(null)}
          onConfirm={async () => { if (await run(() => adminApi.deleteUser(modal.user.id), `${modal.user.username} deleted.`)) { setModal(null); reload(true); } }}>
          <p className="muted">This permanently removes the account. Active sessions end when their token expires; use <b>Block</b> to cut them off immediately.</p>
        </ConfirmModal>
      )}
    </>
  );
}
