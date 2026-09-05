import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import * as usersApi from '../api/users.js';
import * as seasonsApi from '../api/seasons.js';
import type { Season } from '../types.js';

function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

interface NavCard {
  to: string;
  label: string;
  description: string;
  emoji: string;
}

const NAV_CARDS: NavCard[] = [
  { to: '/classement', label: 'Classement', description: 'Le classement de la saison', emoji: '🏆' },
  { to: '/defis', label: 'Défis', description: 'Défie un ou plusieurs joueurs', emoji: '⚔️' },
  { to: '/mini-jeux', label: 'Mini-jeux', description: 'Rejoins un quiz en direct', emoji: '🧠' },
  { to: '/gambling', label: 'Gambling', description: 'Ouvre des caisses, tente ta chance', emoji: '🎰' },
  { to: '/cosmetiques', label: 'Cosmétiques', description: 'Cadres, fonds, titres, polices…', emoji: '✨' },
  { to: '/encheres', label: 'Enchères', description: 'Enchéris sur des cosmétiques exclusifs', emoji: '🔨' },
];

export default function Home() {
  const { user, setUser, equippedCosmetics } = useAuth();
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [rank, setRank] = useState<number | null | undefined>(undefined);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [bonusError, setBonusError] = useState<string | null>(null);
  const [bonusAmount, setBonusAmount] = useState<number | null>(null);

  useEffect(() => {
    seasonsApi.getActiveSeason().then(setActiveSeason).catch(() => setActiveSeason(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    usersApi
      .getStats(user.username)
      .then((s) => setRank(s.rank))
      .catch(() => {});
  }, [user?.username]);

  async function handleClaimBonus() {
    setBonusError(null);
    setClaimingBonus(true);
    try {
      const result = await usersApi.claimDailyBonus();
      setUser(result.profile);
      if (result.alreadyClaimed) {
        setBonusError('Bonus déjà réclamé aujourd\'hui.');
      } else {
        setBonusAmount(result.amount);
      }
    } catch (err) {
      setBonusError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setClaimingBonus(false);
    }
  }

  if (!user) return null;

  const bonusClaimedToday = user.last_login_date === todayLocal();

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-1 flex items-center gap-2 flex-wrap">
          Bonjour,{' '}
          <UserNameTag username={user.username} equipped={equippedCosmetics} className="text-2xl font-bold text-zinc-50" />
          👋
        </h1>
        {activeSeason && <p className="text-sm text-zinc-400 mb-6">Saison active : {activeSeason.name}</p>}

        <div className="flex items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-4">
          <div>
            <p className="text-sm font-medium text-zinc-100">
              {bonusClaimedToday ? 'Bonus quotidien réclamé ✓' : 'Bonus quotidien disponible'}
            </p>
            <p className="text-xs text-zinc-500">
              {bonusClaimedToday
                ? 'Reviens demain pour continuer ta série.'
                : 'Réclame-le pour garder ta série en vie.'}
            </p>
            {bonusAmount !== null && (
              <p className="text-xs text-emerald-400 font-medium mt-1">+{bonusAmount} SP reçus</p>
            )}
            {bonusError && <p className="text-xs text-red-400 mt-1">{bonusError}</p>}
          </div>
          {!bonusClaimedToday && (
            <button
              onClick={handleClaimBonus}
              disabled={claimingBonus}
              className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              {claimingBonus ? '…' : 'Réclamer'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-emerald-500/10 rounded-xl p-4">
            <p className="text-xs text-zinc-400 uppercase">Solde SP</p>
            <p className="text-2xl font-bold text-emerald-400">{user.sp_balance}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-400 uppercase">Streak</p>
            <p className="text-2xl font-bold text-zinc-100">{user.login_streak} 🔥</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-400 uppercase">Rang</p>
            <p className="text-2xl font-bold text-zinc-100">{rank ? `#${rank}` : '—'}</p>
          </div>
        </div>

        <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">Accès rapide</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {NAV_CARDS.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 hover:border-emerald-500/50 transition"
            >
              <span className="text-2xl">{c.emoji}</span>
              <div className="min-w-0">
                <p className="font-medium text-zinc-100">{c.label}</p>
                <p className="text-xs text-zinc-500 truncate">{c.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
