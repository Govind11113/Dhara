import { HashRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './auth';
import { Audit } from './pages/Audit';
import { AiConfig } from './pages/AiConfig';
import { Dashboard } from './pages/Dashboard';
import { Feedback } from './pages/Feedback';
import { Flags } from './pages/Flags';
import { Login } from './pages/Login';
import { Queue } from './pages/Queue';
import { Report } from './pages/Report';
import { Redemptions } from './pages/Redemptions';
import { Trees } from './pages/Trees';
import { Users } from './pages/Users';
import { Spinner, ToastProvider } from './ui';

const NAV = [
  { to: '/queue', label: 'Review queue' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/report', label: 'Impact report' },
  { to: '/users', label: 'Members' },
  { to: '/trees', label: 'Trees' },
  { to: '/feedback', label: 'Feedback' },
  { to: '/flags', label: 'Fraud flags' },
  { to: '/redemptions', label: 'Redemptions' },
  { to: '/ai', label: 'AI & settings' },
  { to: '/audit', label: 'Audit log' },
];

function Shell() {
  const { state, signOut } = useAuth();
  if (state.status !== 'admin') return null;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="side">
        <div className="brand">Dhara <span>Admin</span></div>
        <nav aria-label="Main">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} className={({ isActive }) => (isActive ? 'nav nav-on' : 'nav')}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="side-foot">
          <div className="muted small" title={state.user.email}>{state.user.email}</div>
          <button type="button" className="btn btn-small" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function Gate() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="boot">
        <Spinner label="Checking your session" />
      </div>
    );
  }
  if (state.status === 'signedOut') return <Login message={state.message} />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/report" element={<Report />} />
        <Route path="/users" element={<Users />} />
        <Route path="/trees" element={<Trees />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/flags" element={<Flags />} />
        <Route path="/redemptions" element={<Redemptions />} />
        <Route path="/ai" element={<AiConfig />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    // Hash routing: the site is a static bundle, so deep links must not depend
    // on the host rewriting unknown paths back to index.html.
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  );
}
