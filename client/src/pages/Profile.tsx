import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as transactionsApi from '../api/transactions.js';
import * as usersApi from '../api/users.js';
import * as gamblingApi from '../api/gambling.js';
import * as subscriptionsApi from '../api/subscriptions.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import { TRANSACTION_TYPE_LABELS } from '../lib/transactionLabels.js';
import Avatar from '../components/Avatar.jsx';
import RankBadge from '../components/RankBadge.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import ProfileBackdrop from '../components/ProfileBackdrop.jsx';
import ProfileReactions from '../components/ProfileReactions.jsx';
import type {
  EquippedCosmetic,
  GamblingInventoryEntry,
  ProfileReactionSummary,
  SpTransaction,
  Subscription,
} from '../types.js';

const TRANSACTIONS_POLL_INTERVAL_MS = 10000;
const TRANSACTIONS_PAGE_SIZE = 20;
const KOFI_URL = import.meta.env.VITE_KOFI_URL as string | undefined;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Profile() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<SpTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const loadedMoreRef = useRef(false);
  const [inventory, setInventory] = useState<GamblingInventoryEntry[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [equipped, setEquipped] = useState<EquippedCosmetic[]>([]);
  const [codeCopied, setCodeCopied] = useState(false);
  const [rank, setRank] = useState<number | null | undefined>(undefined);
  const [reactions, setReactions] = useState<ProfileReactionSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function loadFirstPage() {
      return transactionsApi
        .getMyTransactions(TRANSACTIONS_PAGE_SIZE, 0)
        .then((freshFirstPage) => {
          setTransactions((prev) => {
            const freshIds = new Set(freshFirstPage.map((t) => t.id));
            const older = prev.filter((t) => !freshIds.has(t.id));
            return [...freshFirstPage, ...older];
          });
          // Tant que le joueur n'a pas cliqué "Charger plus", le poll seul détermine
          // s'il reste des transactions plus anciennes à proposer.
          if (!loadedMoreRef.current) {
            setHasMoreTransactions(freshFirstPage.length === TRANSACTIONS_PAGE_SIZE);
          }
        })
        .catch(() => {
          // Silencieux en arrière-plan : la liste garde ses dernières valeurs connues.
        })
        .finally(() => setLoadingTransactions(false));
    }
    loadFirstPage();
    const interval = setInterval(loadFirstPage, TRANSACTIONS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleLoadMoreTransactions() {
    setLoadingMoreTransactions(true);
    loadedMoreRef.current = true;
    try {
      const next = await transactionsApi.getMyTransactions(TRANSACTIONS_PAGE_SIZE, transactions.length);
      setTransactions((prev) => [...prev, ...next]);
      setHasMoreTransactions(next.length === TRANSACTIONS_PAGE_SIZE);
    } catch {
      // Silencieux : le bouton "Charger plus" reste disponible pour réessayer.
    } finally {
      setLoadingMoreTransactions(false);
    }
  }

  useEffect(() => {
    gamblingApi.getMyInventory().then(setInventory).catch(() => {});
  }, []);

  useEffect(() => {
    cosmeticsApi
      .getMine()
      .then((data) => setEquipped(data.equipped))
      .catch(() => {});
  }, []);

  useEffect(() => {
    subscriptionsApi.getMine().then(setSubscription).catch(() => {});
  }, []);

  async function handleCopyCode() {
    if (!subscription) return;
    try {
      await navigator.clipboard.writeText(subscription.link_code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (permissions navigateur) : le code reste affichable à la main.
    }
  }

  useEffect(() => {
    if (!user) return;
    usersApi
      .getStats(user.username)
      .then((s) => setRank(s.rank))
      .catch(() => {});
  }, [user?.username]);

  useEffect(() => {
    if (!user) return;
    usersApi
      .getProfileReactions(user.username)
      .then(setReactions)
      .catch(() => {});
  }, [user?.username]);

  async function handleLogout() {
    await logout();
    navigate('/connexion');
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAvatarError(null);
    setUploading(true);
    try {
      const updated = await usersApi.uploadAvatar(file);
      setUser(updated);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleVisibility() {
    if (!user) return;
    setVisibilityError(null);
    setTogglingVisibility(true);
    try {
      const updated = await usersApi.setLeaderboardVisibility(!user.is_leaderboard_hidden);
      setUser(updated);
    } catch (err) {
      setVisibilityError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setTogglingVisibility(false);
    }
  }

  if (!user) return null;

  const bannerUrl = equipped.find((c) => c.slot === 'banner')?.image_url ?? null;
  const frameUrl = equipped.find((c) => c.slot === 'avatar_frame')?.image_url ?? null;

  return (
    <ProfileBackdrop bannerUrl={bannerUrl}>
      <div className="flex items-center justify-center">
      <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 rounded-xl shadow-md w-full max-w-md overflow-hidden">
        <div className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative group disabled:opacity-50"
            title="Changer l'avatar"
          >
            <Avatar
              username={user.username}
              avatarUrl={user.avatar_url}
              size={64}
              crown={rank === 1}
              frameUrl={frameUrl}
            />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-xs text-white">
              {uploading ? '…' : 'Modifier'}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarChange}
            className="hidden"
          />
          <div>
            <div className="flex items-center gap-2">
              <UserNameTag username={user.username} equipped={equipped} className="text-xl text-zinc-50" />
              {rank !== undefined && <RankBadge rank={rank} size="sm" />}
            </div>
            <p className="text-sm text-zinc-400">{user.email}</p>
            {reactions && (
              <div className="mt-2">
                <ProfileReactions
                  likeCount={reactions.likeCount}
                  dislikeCount={reactions.dislikeCount}
                  userReaction={reactions.userReaction}
                />
              </div>
            )}
            <div className="flex items-center gap-3 mt-2">
              <Link
                to={`/joueurs/${user.username}`}
                className="text-xs text-emerald-400 font-medium hover:underline"
              >
                Voir mes stats détaillées →
              </Link>
              <Link
                to="/cosmetiques"
                className="text-xs text-emerald-400 font-medium hover:underline"
              >
                Mes cosmétiques →
              </Link>
            </div>
          </div>
        </div>

        {avatarError && <p className="mb-4 text-sm text-red-400">{avatarError}</p>}

        <dl className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-emerald-500/10 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Solde SP</dt>
            <dd className="text-2xl font-bold text-emerald-400">{user.sp_balance}</dd>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Total gagné</dt>
            <dd className="text-2xl font-bold text-zinc-100">{user.sp_total_earned}</dd>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Streak</dt>
            <dd className="text-2xl font-bold text-zinc-100">{user.login_streak} 🔥</dd>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <dt className="text-xs text-zinc-400 uppercase">Rôle</dt>
            <dd className="text-2xl font-bold text-zinc-100">
              {user.role === 'admin' ? 'MSP' : 'Joueur'}
            </dd>
          </div>
        </dl>

        {user.role === 'admin' && (
          <div className="flex items-center justify-between gap-4 bg-zinc-800 rounded-lg p-4 mb-4">
            <div>
              <p className="text-sm font-medium text-zinc-100">Invisible du classement</p>
              <p className="text-xs text-zinc-500">
                Masque ton compte MSP du classement, des archives de saison et du rang des autres
                joueurs.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={user.is_leaderboard_hidden}
              onClick={handleToggleVisibility}
              disabled={togglingVisibility}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
                user.is_leaderboard_hidden ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                  user.is_leaderboard_hidden ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}
        {visibilityError && <p className="mb-4 text-sm text-red-400">{visibilityError}</p>}

        {subscription && (
          <div className="bg-zinc-800 rounded-lg p-4 mb-4">
            <p className="text-sm font-medium text-zinc-100 mb-1">Abonnement</p>
            {subscription.isActive ? (
              <>
                <p className="text-xs text-emerald-400">
                  Actif jusqu'au {formatDate(subscription.current_period_end as string)}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Sert uniquement à financer les serveurs — merci ! Un don ponctuel ou récurrent
                  prolonge ton accès à chaque paiement reçu.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-zinc-500 mb-2">
                  Débloque des avantages (caisse dédiée) et finance les serveurs. Don ponctuel ou
                  récurrent, au choix sur Ko-fi.{' '}
                  {KOFI_URL ? (
                    <a
                      href={KOFI_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 font-medium hover:underline"
                    >
                      Soutenir sur Ko-fi →
                    </a>
                  ) : (
                    'Demande le lien Ko-fi au MSP.'
                  )}
                </p>
                <p className="text-xs text-zinc-500 mb-2">
                  Colle ce code (et rien d'autre) dans le champ message de ton paiement Ko-fi pour
                  relier ton compte — obligatoire la <strong>première fois</strong> ; pour un
                  abonnement récurrent, les renouvellements suivants sont reconnus automatiquement.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-center tracking-widest bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-emerald-400 font-mono font-bold">
                    {subscription.link_code}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 font-medium px-3 py-2 rounded-md transition"
                  >
                    {codeCopied ? 'Copié ✓' : 'Copier'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold py-2 rounded-md transition mb-6"
        >
          Déconnexion
        </button>

        <div>
          <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
            Historique des transactions
          </h2>
          {loadingTransactions ? (
            <p className="text-sm text-zinc-500">Chargement…</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune transaction pour le moment.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {transactions.map((tx) => (
                  <li
                    key={tx.id}
                    className={`flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2 text-sm ${
                      tx.revoked_at ? 'opacity-50' : ''
                    }`}
                  >
                    <div>
                      <p className="text-zinc-200">{TRANSACTION_TYPE_LABELS[tx.type]}</p>
                      <p className="text-xs text-zinc-500">
                        {formatDate(tx.created_at)}
                        {tx.note ? ` · ${tx.note}` : ''}
                      </p>
                      {tx.revoked_at && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                          Révoquée
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-bold whitespace-nowrap ${
                        tx.revoked_at
                          ? 'line-through text-zinc-500'
                          : tx.amount >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount}
                    </span>
                  </li>
                ))}
              </ul>
              {hasMoreTransactions && (
                <button
                  type="button"
                  onClick={handleLoadMoreTransactions}
                  disabled={loadingMoreTransactions}
                  className="mt-3 w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 rounded-md transition disabled:opacity-50"
                >
                  {loadingMoreTransactions ? 'Chargement…' : 'Charger plus'}
                </button>
              )}
            </>
          )}
        </div>

        {inventory.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
              Collection gambling
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {inventory.map((item) => (
                <div
                  key={item.id}
                  className="bg-zinc-800/60 rounded-lg p-2 flex flex-col items-center text-center"
                  title={item.title}
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      className="w-10 h-10 rounded-lg object-cover mb-1"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center text-lg mb-1">
                      🎁
                    </div>
                  )}
                  <p className="text-xs text-zinc-300 truncate w-full">{item.title}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
      </div>
    </ProfileBackdrop>
  );
}
