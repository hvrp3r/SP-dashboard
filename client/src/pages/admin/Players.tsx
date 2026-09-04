import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import * as usersApi from '../../api/users.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import type { AdminUserSummary } from '../../types.js';

export default function AdminPlayers() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [players, setPlayers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await usersApi.listAllUsers();
      setPlayers(data);
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

  async function handleToggleDisabled(p: AdminUserSummary) {
    const disabling = !p.disabled_at;
    const ok = await confirm({
      title: disabling ? 'Désactiver le compte' : 'Réactiver le compte',
      message: disabling
        ? `${p.username} ne pourra plus se connecter et disparaîtra du classement. Son historique (transactions, défis…) est conservé.`
        : `${p.username} pourra à nouveau se connecter et réapparaîtra dans le classement.`,
      confirmLabel: disabling ? 'Désactiver' : 'Réactiver',
      danger: disabling,
    });
    if (!ok) return;

    setError(null);
    setTogglingId(p.id);
    try {
      const updated = await usersApi.setUserDisabled(p.id, disabling);
      setPlayers((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Joueurs</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
          {loading ? (
            <p className="p-6 text-center text-zinc-500">Chargement…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Joueur</th>
                    <th className="px-4 py-3 text-left">Rôle</th>
                    <th className="px-4 py-3 text-right">Solde SP</th>
                    <th className="px-4 py-3 text-left">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr
                      key={p.id}
                      className={`border-t border-zinc-800 ${p.disabled_at ? 'opacity-60' : ''}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-medium text-zinc-100">{p.username}</span>
                        <span className="block text-xs text-zinc-500">{p.email}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {p.role === 'admin' ? 'MSP' : 'Joueur'}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300 whitespace-nowrap">
                        {p.sp_balance}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.disabled_at ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-400">
                            Désactivé
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400">
                            Actif
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {p.id === user?.id ? (
                          <span className="text-xs text-zinc-600">Ton compte</span>
                        ) : (
                          <button
                            onClick={() => handleToggleDisabled(p)}
                            disabled={togglingId === p.id}
                            className={`text-sm font-medium hover:underline disabled:opacity-50 ${
                              p.disabled_at ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {togglingId === p.id
                              ? '…'
                              : p.disabled_at
                                ? 'Réactiver'
                                : 'Désactiver'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
