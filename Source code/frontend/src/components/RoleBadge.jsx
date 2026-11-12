import Icon from './Icon';

const META = {
  owner: { icon: 'crown', text: 'owner', title: 'Room owner' },
  admin: { icon: 'shield', text: 'admin', title: 'Site administrator' }
};

/** "owner" / "admin" pill shown next to a participant's name. */
export default function RoleBadge({ role }) {
  const m = META[role];
  if (!m) return null;
  return <span className={`role-badge ${role}`} title={m.title}><Icon name={m.icon} size={11} />{m.text}</span>;
}

export const RoleBadges = ({ roles = [] }) => roles.map((r) => <RoleBadge key={r} role={r} />);
