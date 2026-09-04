import { useEffect, useState } from 'react';
import * as subscriptionsApi from '../../api/subscriptions.js';
import * as usersApi from '../../api/users.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import type { AdminUserSummary, KofiEvent, SubscriptionAdminEntry } from '../../types.js';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isCurrentlyActive(sub: SubscriptionAdminEntry): boolean {
  return sub.status === 'active' && !!sub.current_period_end && new Date(sub.current_period_end) > new Date();
}

// Aujourd'hui + 35 jours, format YYYY-MM-DD attendu par <input type="date">.
function defaultExtensionDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  return d.toISOString().slice(0, 10);
}

export default function AdminSubscriptions() {
  const confirm = useConfirm();
  const [subs, setSubs] = useState<SubscriptionAdminEntry[]>([]);
  const [unmatched, setUnmatched] = useState<KofiEvent[]>([]);
  const [players, setPlayers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [extendDrafts, setExtendDrafts] = useState<Record<number, string>>({});
  const [savingUserId, setSavingUserId] = useState<number | null>(null);

  const [matchDrafts, setMatchDrafts] = useState<Record<number, string>>({});
  const [matchingEventId, setMatchingEventId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [subsData, unmatchedData, playersData] = await Promise.all([
        subscriptionsApi.adminListAll(),
        subscriptionsApi.adminListUnmatched(),
        usersApi.listAllUsers(),
      ]);
      setSubs(subsData);
      setUnmatched(unmatchedData);
      setPlayers(playersData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleExtend(sub: SubscriptionAdminEntry) {
    const date = extendDrafts[sub.user_id] ?? defaultExtensionDate();
    setSavingUserId(sub.user_id);
    setError(null);
    try {
      const updated = await subscriptionsApi.adminSetStatus(sub.user_id, {
        status: 'active',
        currentPeriodEnd: new Date(`${date}T23:59:59`).toISOString(),
      });
      setSubs((prev) =>
        prev.map((s) => (s.user_id === sub.user_id ? { ...s, ...updated } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleRevoke(sub: SubscriptionAdminEntry) {
    const ok = await confirm({
      title: "Révoquer l'abonnement",
      message: `${sub.username} perdra immédiatement l'accès aux avantages réservés aux abonnés.`,
      confirmLabel: 'Révoquer',
      danger: true,
    });
    if (!ok) return;
    setSavingUserId(sub.user_id);
    setError(null);
    try {
      const updated = await subscriptionsApi.adminSetStatus(sub.user_id, {
        status: 'inactive',
        currentPeriodEnd: null,
      });
      setSubs((prev) =>
        prev.map((s) => (s.user_id === sub.user_id ? { ...s, ...updated } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleMatch(event: KofiEvent) {
    const userId = Number(matchDrafts[event.id]);
    if (!Number.isInteger(userId)) return;
    setMatchingEventId(event.id);
    setError(null);
    try {
      await subscriptionsApi.adminMatchUnmatched(event.id, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setMatchingEventId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-2">Abonnements</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Encaissés sur Ko-fi (finance les serveurs, prix fixé sur la page Ko-fi elle-même). Ko-fi ne notifie que les paiements
          réussis, jamais les annulations — l'accès expire donc de lui-même à la date de fin
          affichée si aucun renouvellement n'est reçu.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {!loading && unmatched.length > 0 && (
          <div className="bg-zinc-900 border border-amber-500/30 rounded-xl shadow-md overflow-hidden mb-6">
            <div className="p-4 border-b border-zinc-800">
              <h2 className="font-semibold text-amber-400">
                Paiements Ko-fi non rattachés ({unmatched.length})
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                Dons ponctuels ou abonnements dont le code de liaison ne correspondait à aucun
                compte (faute de frappe, ou code absent). Rattache-les manuellement.
              </p>
            </div>
            <ul className="divide-y divide-zinc-800">
              {unmatched.map((e) => (
                <li key={e.id} className="p-4 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm text-zinc-100">
                      {e.from_name || 'Anonyme'} — {e.amount} {e.currency}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {e.email || 'email inconnu'} · {formatDate(e.kofi_timestamp)}
                      {e.message && ` · message : « ${e.message} »`}
                    </p>
                  </div>
                  <select
                    value={matchDrafts[e.id] ?? ''}
                    onChange={(ev) =>
                      setMatchDrafts((prev) => ({ ...prev, [e.id]: ev.target.value }))
                    }
                    className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Choisir un joueur…</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.username}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleMatch(e)}
                    disabled={!matchDrafts[e.id] || matchingEventId === e.id}
                    className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                  >
                    {matchingEventId === e.id ? '…' : 'Rattacher'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
          {loading ? (
            <p className="p-6 text-center text-zinc-500">Chargement…</p>
          ) : subs.length === 0 ? (
            <p className="p-6 text-center text-zinc-500">
              Aucun joueur n'a encore consulté sa page d'abonnement.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {subs.map((s) => {
                const active = isCurrentlyActive(s);
                return (
                  <li key={s.id} className="p-4 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-sm font-medium text-zinc-100">{s.username}</p>
                      <p className="text-xs text-zinc-500">
                        {s.kofi_email ?? 'pas encore payé'} · dernier paiement{' '}
                        {formatDate(s.last_payment_at)}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                        active
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {active ? `Actif jusqu'au ${formatDate(s.current_period_end)}` : 'Inactif'}
                    </span>
                    <input
                      type="date"
                      value={extendDrafts[s.user_id] ?? defaultExtensionDate()}
                      onChange={(e) =>
                        setExtendDrafts((prev) => ({ ...prev, [s.user_id]: e.target.value }))
                      }
                      className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      onClick={() => handleExtend(s)}
                      disabled={savingUserId === s.user_id}
                      className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                    >
                      {active ? 'Prolonger' : 'Activer'}
                    </button>
                    {active && (
                      <button
                        onClick={() => handleRevoke(s)}
                        disabled={savingUserId === s.user_id}
                        className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                      >
                        Révoquer
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
