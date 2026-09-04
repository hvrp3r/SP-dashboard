import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import NotificationBell from './NotificationBell.jsx';
import Avatar from './Avatar.jsx';
import * as gamblingApi from '../api/gambling.js';
import type { GamblingGameInfo } from '../types.js';

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

function ProfileMenu() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isProfileRouteActive =
    location.pathname.startsWith('/profil') ||
    location.pathname.startsWith('/cosmetiques') ||
    location.pathname.startsWith('/admin');

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

  if (!user) return null;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-all duration-200 ease-out transform hover:scale-105 active:scale-95 ${
          isProfileRouteActive
            ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        <Avatar
          username={user.username}
          avatarUrl={user.avatar_url}
          size={22}
          className="border-2 border-zinc-950"
        />
        {user.username}
        <span className="text-xs font-semibold bg-zinc-950/50 text-emerald-300 px-1.5 py-0.5 rounded-full">
          {user.sp_balance} SP
        </span>
        <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/30 z-50 overflow-hidden origin-top-right"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
            <Avatar username={user.username} avatarUrl={user.avatar_url} size={36} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100 truncate">{user.username}</p>
              <p className="text-xs text-emerald-400 font-semibold">{user.sp_balance} SP</p>
            </div>
          </div>
          <div className="py-1">
            <NavLink to="/profil" className={dropdownLinkClass}>
              Mon profil
            </NavLink>
            <NavLink to="/cosmetiques" className={dropdownLinkClass}>
              Cosmétiques
            </NavLink>
          </div>

          {user.role === 'admin' && (
            <div className="py-1 border-t border-zinc-800">
              <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                Admin
              </p>
              <NavLink to="/admin/joueurs" className={dropdownLinkClass}>
                Joueurs
              </NavLink>
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
              <NavLink to="/admin/abonnements" className={dropdownLinkClass}>
                Abonnements
              </NavLink>
              <NavLink to="/admin/cosmetiques" className={dropdownLinkClass}>
                Cosmétiques (MSP)
              </NavLink>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GamblingMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<GamblingGameInfo[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const isGamblingRouteActive = location.pathname.startsWith('/gambling');

  useEffect(() => {
    gamblingApi
      .listGames()
      .then(setGames)
      .catch(() => {});
  }, []);

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

  const activeGames = games.filter((g) => g.enabled);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-all duration-200 ease-out transform hover:scale-105 active:scale-95 ${
          isGamblingRouteActive
            ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        Gambling{' '}
        <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/30 z-50 overflow-hidden origin-top-left py-1"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          <NavLink to="/gambling" end className={dropdownLinkClass}>
            Tous les jeux
          </NavLink>
          {activeGames.map((g) => (
            <NavLink key={g.id} to={g.path} className={dropdownLinkClass}>
              {g.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <nav
      className="sticky top-0 z-40 bg-zinc-900/85 backdrop-blur-md border-b border-zinc-800 px-4 py-2 shadow-lg shadow-black/20"
      style={{ animation: 'fadeSlideDown 0.3s ease-out' }}
    >
      <div className="max-w-2xl mx-auto flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1 justify-center flex-wrap">
          <NavLink to="/" end className={linkClass}>
            Accueil
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
          <GamblingMenu />
        </div>
        <ProfileMenu />
        <NotificationBell />
      </div>
    </nav>
  );
}
