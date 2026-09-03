import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import NotificationBell from './NotificationBell.jsx';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-all duration-200 ease-out transform hover:scale-105 active:scale-95 ${
    isActive
      ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
  }`;

const dropdownLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-4 py-2.5 text-sm transition-colors duration-150 ${
    isActive
      ? 'bg-emerald-500/15 text-emerald-400 font-medium'
      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
  }`;

function AdminMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAdminRouteActive = location.pathname.startsWith('/admin');

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-all duration-200 ease-out transform hover:scale-105 active:scale-95 ${
          isAdminRouteActive
            ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        Admin <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/30 z-50 overflow-hidden origin-top-left py-1"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          <NavLink to="/admin/saisons" className={dropdownLinkClass}>
            Saisons
          </NavLink>
          <NavLink to="/admin/config" className={dropdownLinkClass}>
            Config
          </NavLink>
          <NavLink to="/admin/transactions" className={dropdownLinkClass}>
            Transactions
          </NavLink>
          <NavLink to="/admin/defis" className={dropdownLinkClass}>
            Arbitrage
          </NavLink>
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const { user } = useAuth();
  if (!user) return null;

  const isAdmin = user.role === 'admin';

  return (
    <nav
      className="sticky top-0 z-40 bg-zinc-900/85 backdrop-blur-md border-b border-zinc-800 px-4 py-2 shadow-lg shadow-black/20"
      style={{ animation: 'fadeSlideDown 0.3s ease-out' }}
    >
      <div className="max-w-2xl mx-auto flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1 justify-center flex-wrap">
          <NavLink to="/profil" className={linkClass}>
            Profil
          </NavLink>
          <NavLink to="/classement" className={linkClass}>
            Classement
          </NavLink>
          <NavLink to="/defis" className={linkClass}>
            Défis
          </NavLink>
          <NavLink to="/mini-jeux" className={linkClass}>
            Mini-jeux
          </NavLink>
          <NavLink to="/gambling" className={linkClass}>
            Gambling
          </NavLink>
          {isAdmin && <AdminMenu />}
        </div>
        <NotificationBell />
      </div>
    </nav>
  );
}
