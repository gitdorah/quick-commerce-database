import { NavLink, Route, Routes } from 'react-router-dom';
import { useSession } from './context/SessionContext.jsx';
import MyOrders from './pages/MyOrders.jsx';
import OpsInventory from './pages/OpsInventory.jsx';
import OpsOrders from './pages/OpsOrders.jsx';
import Reports from './pages/Reports.jsx';
import Storefront from './pages/Storefront.jsx';
import StressTest from './pages/StressTest.jsx';

const NAV = [
  {
    group: 'Customer',
    links: [
      { to: '/', label: 'Shop', end: true },
      { to: '/orders', label: 'My orders' },
    ],
  },
  {
    group: 'Operations',
    links: [
      { to: '/ops', label: 'Orders board', end: true },
      { to: '/ops/inventory', label: 'Inventory' },
    ],
  },
  {
    group: 'Database',
    links: [
      { to: '/stress', label: 'Stress test' },
      { to: '/reports', label: 'Reports' },
    ],
  },
];

function NotFound() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <NavLink to="/">Back to the shop</NavLink>
    </div>
  );
}

export default function App() {
  const { error } = useSession();

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M13 2 4 14h6l-1 8 9-12h-6z" />
          </svg>
          <span>QuickCommerce</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ group, links }) => (
            <div key={group} className="nav-group">
              <span className="nav-group-label">{group}</span>
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end}>
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </header>

      {error && (
        <div className="notice notice-critical global-error">
          Cannot reach the API or database: {error.message}. Is the server running and has{' '}
          <code>npm run db:setup</code> been run?
        </div>
      )}

      <main>
        <Routes>
          <Route path="/" element={<Storefront />} />
          <Route path="/orders" element={<MyOrders />} />
          <Route path="/ops" element={<OpsOrders />} />
          <Route path="/ops/inventory" element={<OpsInventory />} />
          <Route path="/stress" element={<StressTest />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
