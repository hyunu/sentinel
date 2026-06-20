import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import BoardsPage from './pages/Boards';
import ProtocolsPage from './pages/Protocols';
import DataViewerPage from './pages/DataViewer';
import VizDashboardPage from './pages/VizDashboard';
import AIQueryPage from './pages/AIQuery';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-header">
            <h2>Sentinel</h2>
            <p className="muted">UART Monitor</p>
          </div>
          <ul className="nav-links">
            <li><NavLink to="/boards" className={({ isActive }) => isActive ? 'active' : ''}>Boards</NavLink></li>
            <li><NavLink to="/protocols" className={({ isActive }) => isActive ? 'active' : ''}>Protocols</NavLink></li>
            <li><NavLink to="/data" className={({ isActive }) => isActive ? 'active' : ''}>Data Viewer</NavLink></li>
            <li><NavLink to="/viz" className={({ isActive }) => isActive ? 'active' : ''}>Visualization</NavLink></li>
            <li><NavLink to="/ai" className={({ isActive }) => isActive ? 'active' : ''}>AI Query</NavLink></li>
          </ul>
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
