import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import NotificationBell from './NotificationBell.jsx';
import Avatar from './Avatar.jsx';
import UserNameTag from './UserNameTag.jsx';
import * as gamblingApi from '../api/gambling.js';
import type { GamblingGameId, GamblingGameInfo } from '../types.js';

const NAV_LINKS = [
  { to: '/', end: true, label: 'Accueil' },
  { to: '/classement', end: false, label: 'Classement' },
  { to: '/defis', end: false, label: 'Défis' },
];

const CASINO_ICONS: Record<GamblingGameId, string> = {
  crates: '📦',
  blackjack: '🃏',
  crash: '📈',
  tower: '🗼',
};

const dropdownSectionLabelClass =
  'px-4 pt-2 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-all duration-200 ease-out transform hover:scale-105 active:scale-95 ${
    isActive
      ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
  }`;

const dropdownLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors duration-150 ${
    isActive
      ? 'bg-emerald-500/15 text-emerald-400 font-medium'
      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
  }`;

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150 ${
    isActive
      ? 'bg-emerald-500 text-zinc-950'
      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
  }`;

function ProfileMenu() {
  const { user, equippedCosmetics } = useAuth();
  const frameUrl = equippedCosmetics.find((c) => c.slot === 'avatar_frame')?.image_url;
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isProfileRouteActive =
    location.pathname.startsWith('/profil') ||
    location.pathname.startsWith('/suggestions') ||
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
        className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-all duration-200 ease-out transform hover:scale-105 active:scale-95 ${
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
          frameUrl={frameUrl}
        />
        <span className="hidden sm:inline">{user.username}</span>
        <span className="hidden sm:inline text-xs font-semibold bg-zinc-950/50 text-emerald-300 px-1.5 py-0.5 rounded-full">
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
            <Avatar username={user.username} avatarUrl={user.avatar_url} size={36} frameUrl={frameUrl} />
            <div className="min-w-0">
              <UserNameTag
                username={user.username}
                equipped={equippedCosmetics}
                className="text-sm text-zinc-100 truncate"
              />
              <p className="text-xs text-emerald-400 font-semibold">{user.sp_balance} SP</p>
            </div>
          </div>
          <div className="py-1">
            <NavLink to="/profil" className={dropdownLinkClass}>
              Mon profil
            </NavLink>
            <NavLink to="/suggestions" className={dropdownLinkClass}>
              Suggestions
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

function JeuxMenu({ games }: { games: GamblingGameInfo[] }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isJeuxRouteActive =
    location.pathname.startsWith('/motus') ||
    location.pathname.startsWith('/sudoku') ||
    location.pathname.startsWith('/mini-jeux') ||
    location.pathname.startsWith('/gambling');

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
          isJeuxRouteActive
            ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        Jeux <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/30 z-50 overflow-hidden origin-top-left py-1"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          <NavLink to="/mini-jeux" className={dropdownLinkClass}>
            <span>🧠</span> Mini-jeux
          </NavLink>

          <div className="my-1 border-t border-zinc-800" />
          <p className={dropdownSectionLabelClass}>Jeu du jour</p>
          <NavLink to="/motus" className={dropdownLinkClass}>
            <span>🟩</span> Motus
          </NavLink>
          <NavLink to="/sudoku" className={dropdownLinkClass}>
            <span>🔢</span> Sudoku
          </NavLink>

          <p className={dropdownSectionLabelClass}>Casino</p>
          <NavLink to="/gambling" end className={dropdownLinkClass}>
            <span>🎰</span> Tous les jeux
          </NavLink>
          {activeGames.map((g) => (
            <NavLink key={g.id} to={g.path} className={dropdownLinkClass}>
              <span>{CASINO_ICONS[g.id]}</span> {g.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function CosmetiquesMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isCosmetiquesRouteActive =
    location.pathname.startsWith('/cosmetiques') || location.pathname.startsWith('/encheres');

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
          isCosmetiquesRouteActive
            ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        Cosmétiques{' '}
        <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/30 z-50 overflow-hidden origin-top-left py-1"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          <NavLink to="/cosmetiques" className={dropdownLinkClass}>
            <span>✨</span> Ma collection
          </NavLink>
          <NavLink to="/encheres" className={dropdownLinkClass}>
            <span>🔨</span> Enchères
          </NavLink>
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [games, setGames] = useState<GamblingGameInfo[]>([]);
  const mobileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    gamblingApi
      .listGames()
      .then(setGames)
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const activeGames = games.filter((g) => g.enabled);

  return (
    <nav
      className="sticky top-0 z-40 border-b border-zinc-800 shadow-lg shadow-black/20"
      style={{ animation: 'fadeSlideDown 0.3s ease-out' }}
      ref={mobileRef}
    >
      {/* Fond flouté sur un calque séparé, jamais directement sur l'élément `sticky` : combiner
          `backdrop-filter` et `position: sticky` sur le même élément fait disparaître son contenu
          sur Chromium/Brave (bug documenté, indépendant de la version) — https://generatepress.com/forums/topic/sticky-navigation-not-working-on-edge-or-brave-chromium-browsers/ */}
      <div className="absolute inset-0 -z-10 bg-zinc-900/85 backdrop-blur-md" />
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2 flex items-center gap-2">
        <button
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={mobileOpen}
          className="sm:hidden flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800 transition"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-1 sm:justify-center">
          <div className="hidden sm:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
                {link.label}
              </NavLink>
            ))}
            <JeuxMenu games={games} />
            <CosmetiquesMenu />
          </div>
          <NavLink
            to="/"
            end
            className="sm:hidden block truncate text-base font-bold text-zinc-100 hover:text-emerald-400 transition-colors"
          >
            😊 Points Sourires
          </NavLink>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ProfileMenu />
          <NotificationBell />
        </div>
      </div>

      {mobileOpen && (
        <div
          className="sm:hidden border-t border-zinc-800 px-3 py-2 flex flex-col gap-0.5 max-h-[70vh] overflow-y-auto"
          style={{ animation: 'fadeSlideIn 0.15s ease-out' }}
        >
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={mobileLinkClass}>
              {link.label}
            </NavLink>
          ))}

          <NavLink to="/mini-jeux" className={mobileLinkClass}>
            🧠 Mini-jeux
          </NavLink>

          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
            Jeu du jour
          </p>
          <NavLink to="/motus" className={mobileLinkClass}>
            🟩 Motus
          </NavLink>
          <NavLink to="/sudoku" className={mobileLinkClass}>
            🔢 Sudoku
          </NavLink>

          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
            Casino
          </p>
          <NavLink to="/gambling" end className={mobileLinkClass}>
            🎰 Tous les jeux
          </NavLink>
          {activeGames.map((g) => (
            <NavLink key={g.id} to={g.path} className={mobileLinkClass}>
              {CASINO_ICONS[g.id]} {g.name}
            </NavLink>
          ))}

          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
            Cosmétiques
          </p>
          <NavLink to="/cosmetiques" className={mobileLinkClass}>
            ✨ Ma collection
          </NavLink>
          <NavLink to="/encheres" className={mobileLinkClass}>
            🔨 Enchères
          </NavLink>
        </div>
      )}
    </nav>
  );
}
