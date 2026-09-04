import { Fragment, useEffect, useState, type FormEvent } from 'react';
import * as transactionsApi from '../../api/transactions.js';
import * as seasonsApi from '../../api/seasons.js';
import * as usersApi from '../../api/users.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { TRANSACTION_TYPE_LABELS } from '../../lib/transactionLabels.js';
import type { AdminUserSummary, Season, SpTransactionEntry, SpTransactionType } from '../../types.js';

type ManualType = 'admin_grant' | 'admin_deduct';

const PAGE_SIZE = 25;

const TYPE_OPTIONS: Array<{ value: SpTransactionType | ''; label: string }> = [
  { value: '', label: 'Tous les types' },
  ...(Object.keys(TRANSACTION_TYPE_LABELS) as SpTransactionType[]).map((type) => ({
    value: type,
    label: TRANSACTION_TYPE_LABELS[type],
  })),
];

interface SeasonGroup {
  seasonId: number | null;
  items: SpTransactionEntry[];
}

function groupBySeason(entries: SpTransactionEntry[]): SeasonGroup[] {
  const groups: SeasonGroup[] = [];
  for (const tx of entries) {
    const last = groups[groups.length - 1];
    if (last && last.seasonId === tx.season_id) {
      last.items.push(tx);
    } else {
      groups.push({ seasonId: tx.season_id, items: [tx] });
    }
  }
  return groups;
}

export default function AdminTransactions() {
  const confirm = useConfirm();
  const [type, setType] = useState<SpTransactionType | ''>('');
  const [filterPlayerId, setFilterPlayerId] = useState('');
  const [entries, setEntries] = useState<SpTransactionEntry[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const [players, setPlayers] = useState<AdminUserSummary[]>([]);
  const [formPlayerId, setFormPlayerId] = useState('');
  const [formType, setFormType] = useState<ManualType>('admin_grant');
  const [formAmount, setFormAmount] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formAffectsTotalEarned, setFormAffectsTotalEarned] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load(
    currentType: SpTransactionType | '',
    currentPlayerId: string,
    currentOffset: number,
    replace: boolean
  ) {
    setLoading(true);
    try {
      const data = await transactionsApi.getAllTransactions({
        type: currentType || undefined,
        userId: currentPlayerId ? Number(currentPlayerId) : undefined,
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
      setEntries((prev) => (replace ? data : [...prev, ...data]));
      setHasMore(data.length === PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    seasonsApi
      .listSeasons()
      .then(setSeasons)
      .catch(() => setSeasons([]));
    usersApi
      .listAllUsers()
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, []);

  useEffect(() => {
    setOffset(0);
    load(type, filterPlayerId, 0, true);
  }, [type, filterPlayerId]);

  function handleLoadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    load(type, filterPlayerId, nextOffset, false);
  }

  async function handleRevoke(tx: SpTransactionEntry) {
    const ok = await confirm({
      title: 'Révoquer la transaction',
      message: `Transaction de ${tx.amount >= 0 ? '+' : ''}${tx.amount} SP pour ${tx.username}. Un ajustement inverse sera appliqué à son solde.`,
      confirmLabel: 'Révoquer',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setRevokingId(tx.id);
    try {
      const updated = await transactionsApi.revokeTransaction(tx.id);
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!formPlayerId || !formAmount) return;
    setCreateError(null);
    setCreating(true);
    try {
      await transactionsApi.createTransaction({
        userId: Number(formPlayerId),
        type: formType,
        amount: Number(formAmount),
        note: formNote.trim() || undefined,
        affectsTotalEarned: formAffectsTotalEarned,
      });
      setFormAmount('');
      setFormNote('');
      setOffset(0);
      await load(type, filterPlayerId, 0, true);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  const seasonById = new Map(seasons.map((s) => [s.id, s]));
  const groups = groupBySeason(entries);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Journal des transactions</h1>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Créer une transaction manuelle</h2>
          <form onSubmit={handleCreate} className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <select
                value={formPlayerId}
                onChange={(e) => setFormPlayerId(e.target.value)}
                required
                className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Choisir un joueur</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.username}
                  </option>
                ))}
              </select>
              <select
                value={formType}
                onChange={(e) => {
                  const nextType = e.target.value as ManualType;
                  setFormType(nextType);
                  setFormAffectsTotalEarned(nextType === 'admin_grant');
                }}
                className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="admin_grant">Créditer</option>
                <option value="admin_deduct">Débiter</option>
              </select>
              <input
                type="number"
                min={1}
                required
                placeholder="Montant"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                className="w-28 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <input
              type="text"
              placeholder="Note (optionnel)"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={formAffectsTotalEarned}
                onChange={(e) => setFormAffectsTotalEarned(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
              />
              {formType === 'admin_grant'
                ? 'Compte dans le total gagné (classement)'
                : 'Réduit aussi le total gagné (classement)'}
            </label>
            {createError && <p className="text-sm text-red-400">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              {creating ? 'Création…' : 'Créer'}
            </button>
          </form>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <label className="flex-1 min-w-[160px]">
            <span className="text-sm text-zinc-400">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as SpTransactionType | '')}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-[160px]">
            <span className="text-sm text-zinc-400">Joueur</span>
            <select
              value={filterPlayerId}
              onChange={(e) => setFilterPlayerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Tous les joueurs</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username}
                  {p.disabled_at ? ' (désactivé)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
          {entries.length === 0 && !loading ? (
            <p className="p-6 text-center text-zinc-500">Aucune transaction.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Joueur</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const season = group.seasonId !== null ? seasonById.get(group.seasonId) : null;
                    const isArchived = season?.status === 'closed';

                    return (
                      <Fragment key={`group-${group.seasonId ?? 'none'}-${group.items[0]?.id ?? 0}`}>
                        <tr>
                          <td colSpan={5} className="px-4 py-2 bg-zinc-800/40 border-t border-zinc-800">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-zinc-300 uppercase">
                                {season ? season.name : 'Sans saison'}
                              </span>
                              {season && (
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                    season.status === 'active'
                                      ? 'bg-emerald-500/15 text-emerald-400'
                                      : 'bg-zinc-700 text-zinc-400'
                                  }`}
                                >
                                  {season.status === 'active' ? 'Active' : 'Archivée'}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {group.items.map((tx) => (
                          <tr
                            key={tx.id}
                            className={`border-t border-zinc-800 ${tx.revoked_at ? 'opacity-50' : ''}`}
                          >
                            <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                              {new Date(tx.created_at).toLocaleString('fr-FR')}
                            </td>
                            <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">
                              {tx.username}
                            </td>
                            <td className="px-4 py-3 text-zinc-300">
                              {TRANSACTION_TYPE_LABELS[tx.type]}
                              {tx.note && (
                                <span className="block text-xs text-zinc-500">{tx.note}</span>
                              )}
                              {!tx.affects_total_earned && (
                                <span className="inline-block mt-1 mr-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                                  Hors total gagné
                                </span>
                              )}
                              {tx.revoked_at && (
                                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                                  Révoquée
                                </span>
                              )}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-bold whitespace-nowrap ${
                                tx.revoked_at
                                  ? 'line-through text-zinc-500'
                                  : tx.amount >= 0
                                    ? 'text-emerald-400'
                                    : 'text-red-400'
                              }`}
                            >
                              {tx.amount >= 0 ? '+' : ''}
                              {tx.amount}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {!tx.revoked_at &&
                                (isArchived ? (
                                  <span className="text-xs text-zinc-600">Saison archivée</span>
                                ) : (
                                  <button
                                    onClick={() => handleRevoke(tx)}
                                    disabled={revokingId === tx.id}
                                    className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                                  >
                                    {revokingId === tx.id ? '…' : 'Révoquer'}
                                  </button>
                                ))}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {hasMore && entries.length > 0 && (
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="mt-4 w-full bg-zinc-900 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 font-medium py-2 rounded-md transition disabled:opacity-50"
          >
            {loading ? 'Chargement…' : 'Charger plus'}
          </button>
        )}
      </div>
    </div>
  );
}
