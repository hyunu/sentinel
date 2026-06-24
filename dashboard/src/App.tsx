import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import BoardsPage from './pages/Boards';
import ProtocolsPage from './pages/Protocols';
import DataViewerPage from './pages/DataViewer';
import VizDashboardPage from './pages/VizDashboard';
import AIQueryPage from './pages/AIQuery';
import { IconBoards, IconProtocols, IconData, IconChart, IconAI } from './components/NavIcons';
import './App.css';

const NAV = [
  { to: '/boards', label: 'Boards', Icon: IconBoards },
  { to: '/protocols', label: 'Protocols', Icon: IconProtocols },
  { to: '/data', label: 'Data Viewer', Icon: IconData },
  { to: '/viz', label: 'Visualization', Icon: IconChart },
  { to: '/ai', label: 'AI Query', Icon: IconAI },
] as const;

function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-brand">
            <div className="brand-mark">S</div>
            <div>
              <h2>Sentinel</h2>
              <p>UART Monitor</p>
            </div>
          </div>
          <ul className="nav-links">
            {NAV.map(({ to, label, Icon }) => (
              <li key={to}>
                <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon className="nav-icon" />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="sidebar-footer">
            <span className="sidebar-version">Dashboard v1</span>
          </div>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/boards" replace />} />
            <Route path="/boards" element={<BoardsPage />} />
            <Route path="/protocols" element={<ProtocolsPage />} />
            <Route path="/data" element={<DataViewerPage />} />
            <Route path="/viz" element={<VizDashboardPage />} />
            <Route path="/ai" element={<AIQueryPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
