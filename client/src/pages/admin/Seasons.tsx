import { useEffect, useState, type FormEvent } from 'react';
import * as seasonsApi from '../../api/seasons.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import type { Season } from '../../types.js';

export default function AdminSeasons() {
  const confirm = useConfirm();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);

  const activeSeason = seasons.find((s) => s.status === 'active') ?? null;

  async function loadSeasons() {
    setLoading(true);
    try {
      const data = await seasonsApi.listSeasons();
      setSeasons(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSeasons();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await seasonsApi.createSeason(name.trim());
      setName('');
      await loadSeasons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(seasonId: number) {
    const ok = await confirm({
      title: 'Clôturer la saison',
      message: 'Le classement sera figé et les soldes de tous les joueurs remis à zéro.',
      confirmLabel: 'Clôturer',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setClosingId(seasonId);
    try {
      await seasonsApi.closeSeason(seasonId);
      await loadSeasons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Gestion des saisons</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Créer une nouvelle saison</h2>
          {activeSeason ? (
            <p className="text-sm text-zinc-400">
              Une saison est déjà active ({activeSeason.name}). Clôturez-la avant d'en créer une
              nouvelle.
            </p>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
              <input
                type="text"
                required
                maxLength={100}
                placeholder="Nom de la saison"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={submitting}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Créer
              </button>
            </form>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden">
          {loading ? (
            <p className="p-6 text-center text-zinc-500">Chargement…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/60 text-zinc-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Nom</th>
                    <th className="px-4 py-3 text-left">Début</th>
                    <th className="px-4 py-3 text-left">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((s) => (
                    <tr key={s.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">
                        {s.name}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                        {new Date(s.starts_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                            s.status === 'active'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {s.status === 'active' ? 'Active' : 'Clôturée'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.status === 'active' && (
                          <button
                            onClick={() => handleClose(s.id)}
                            disabled={closingId === s.id}
                            className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                          >
                            {closingId === s.id ? 'Clôture…' : 'Clôturer'}
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
