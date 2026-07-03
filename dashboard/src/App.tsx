import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import BoardsPage from './pages/Boards';
import ProtocolsListPage from './pages/ProtocolsList';
import ProtocolEditPage from './pages/ProtocolEdit';
import ProtocolTemplatesPage from './pages/ProtocolTemplates';
import TemplateEditPage from './pages/TemplateEdit';
import DataViewerPage from './pages/DataViewer';
import VizDashboardPage from './pages/VizDashboard';
import AIQueryPage from './pages/AIQuery';
import { IconBoards, IconProtocols, IconData, IconChart, IconAI } from './components/NavIcons';
import IconSettings from './components/IconSettings';
import IconSidebarToggle from './components/IconSidebarToggle';
import SettingsModal from './components/SettingsModal';
import { useTranslation } from './i18n';
import './App.css';

const SIDEBAR_COLLAPSED_KEY = 'sentinel-sidebar-collapsed';

const NAV = [
  { to: '/boards', key: 'nav.boards', Icon: IconBoards },
  { to: '/protocols', key: 'nav.protocols', Icon: IconProtocols },
  { to: '/data', key: 'nav.dataViewer', Icon: IconData },
  { to: '/viz', key: 'nav.visualization', Icon: IconChart },
  { to: '/ai', key: 'nav.aiQuery', Icon: IconAI },
] as const;

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function AppShell() {
  const { t } = useTranslation();
  const navScrollRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <nav
        className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <div className="brand-mark" title="Sentinel">S</div>
          <div className="sidebar-brand-text">
            <h2>Sentinel</h2>
            <p>{t('app.tagline')}</p>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            <IconSidebarToggle collapsed={sidebarCollapsed} />
          </button>
        </div>
        <div className="nav-links-scroll" ref={navScrollRef}>
          <ul className="nav-links">
            {NAV.map(({ to, key, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                  title={sidebarCollapsed ? t(key) : undefined}
                >
                  <Icon className="nav-icon" />
                  <span className="nav-label">{t(key)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-settings-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('settings.title')}
            title={sidebarCollapsed ? t('settings.title') : undefined}
          >
            <IconSettings className="sidebar-settings-icon" />
            <span>{t('settings.title')}</span>
          </button>
          <span className="sidebar-version">{t('app.version')}</span>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/boards" replace />} />
          <Route path="/boards" element={<BoardsPage />} />
          <Route path="/protocols" element={<ProtocolsListPage />} />
          <Route path="/protocols/templates/new" element={<TemplateEditPage />} />
          <Route path="/protocols/templates/:id/edit" element={<TemplateEditPage />} />
          <Route path="/protocols/templates" element={<ProtocolTemplatesPage />} />
          <Route path="/protocols/new" element={<ProtocolEditPage />} />
          <Route path="/protocols/:id/edit" element={<ProtocolEditPage />} />
          <Route path="/data" element={<DataViewerPage />} />
          <Route path="/viz" element={<VizDashboardPage />} />
          <Route path="/ai" element={<AIQueryPage />} />
        </Routes>
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
