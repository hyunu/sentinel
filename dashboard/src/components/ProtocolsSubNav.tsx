import { NavLink } from 'react-router-dom';

export default function ProtocolsSubNav() {
  return (
    <nav className="protocols-subnav" aria-label="Protocols section">
      <NavLink to="/protocols" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
        Saved protocols
      </NavLink>
      <span className="protocols-subnav-sep" aria-hidden>·</span>
      <NavLink to="/protocols/templates" className={({ isActive }) => (isActive ? 'is-active' : '')}>
        Templates
      </NavLink>
    </nav>
  );
}
