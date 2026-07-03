import { NavLink } from 'react-router-dom';
import { useTranslation } from '../i18n';

export default function ProtocolsSubNav() {
  const { t } = useTranslation();

  return (
    <nav className="protocols-subnav" aria-label={t('protocols.title')}>
      <NavLink to="/protocols" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
        {t('protocols.savedProtocols')}
      </NavLink>
      <span className="protocols-subnav-sep" aria-hidden>·</span>
      <NavLink to="/protocols/templates" className={({ isActive }) => (isActive ? 'is-active' : '')}>
        {t('protocols.templates')}
      </NavLink>
    </nav>
  );
}
