import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as gamblingApi from '../api/gambling.js';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import CrateIcon from '../components/CrateIcon.jsx';
import type { GamblingCrateEntry, GamblingStatus } from '../types.js';

export default function Gambling() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [crates, setCrates] = useState<GamblingCrateEntry[]>([]);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showLimitReached, setShowLimitReached] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [costSp, setCostSp] = useState('');
  const [maxOpensPerPlayer, setMaxOpensPerPlayer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await gamblingApi.listCrates(isAdmin && showArchived);
      setCrates(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, showArchived]);

  useEffect(() => {
    gamblingApi.getStatus().then(setStatus).catch(() => {});
  }, []);

  const isFreeCrate = costSp.trim() === '0';
  const freeWithoutLimit = isFreeCrate && !maxOpensPerPlayer.trim();

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !costSp || freeWithoutLimit) return;
    setError(null);
    setSubmitting(true);
    try {
      await gamblingApi.createCrate({
        name: name.trim(),
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        costSp: Number(costSp),
        maxOpensPerPlayer: maxOpensPerPlayer.trim() ? Number(maxOpensPerPlayer) : null,
      });
      setName('');
      setDescription('');
      setImageUrl('');
      setCostSp('');
      setMaxOpensPerPlayer('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  const limitReached = (c: GamblingCrateEntry) =>
    c.max_opens_per_player !== null && c.myOpenCount >= c.max_opens_per_player;
  const availableCrates = crates.filter((c) => !limitReached(c));
  const limitReachedCrates = crates.filter(limitReached);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Gambling</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {status && <GamblingBudgetBar status={status} />}

        {isAdmin && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
            <h2 className="font-semibold text-zinc-200 mb-3">Créer une caisse</h2>
            <form onSubmit={handleCreate} className="space-y-2">
              <input
                type="text"
                required
                maxLength={100}
                placeholder="Nom de la caisse (ex: Caisse Bronze)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <textarea
                placeholder="Description (optionnel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <input
                type="text"
                placeholder="URL de l'image (optionnel)"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <input
                type="number"
                min={0}
                required
                placeholder="Coût par ouverture (SP, 0 = gratuit)"
                value={costSp}
                onChange={(e) => setCostSp(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <input
                type="number"
                min={1}
                placeholder="Limite d'ouvertures par joueur (optionnel, illimité par défaut)"
                value={maxOpensPerPlayer}
                onChange={(e) => setMaxOpensPerPlayer(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {freeWithoutLimit && (
                <p className="text-xs text-red-400">
                  Une caisse gratuite doit avoir une limite d'ouvertures par joueur.
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || freeWithoutLimit}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Créer
              </button>
            </form>
          </div>
        )}

        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            className="mb-3 text-sm text-zinc-400 hover:text-zinc-200 font-medium transition"
          >
            {showArchived ? 'Masquer les caisses archivées' : 'Voir les caisses archivées'}
          </button>
        )}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableCrates.length === 0 ? (
                <p className="text-zinc-500">Aucune caisse disponible pour le moment.</p>
              ) : (
                availableCrates.map((c) => <CrateCard key={c.id} crate={c} isAdmin={isAdmin} />)
              )}
            </div>

            {limitReachedCrates.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowLimitReached((prev) => !prev)}
                  className="mb-3 text-sm text-zinc-400 hover:text-zinc-200 font-medium transition"
                >
                  {showLimitReached
                    ? 'Masquer les caisses dont tu as atteint la limite'
                    : `Voir les caisses dont tu as atteint la limite (${limitReachedCrates.length})`}
                </button>
                {showLimitReached && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {limitReachedCrates.map((c) => (
                      <CrateCard key={c.id} crate={c} isAdmin={isAdmin} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CrateCard({ crate: c, isAdmin }: { crate: GamblingCrateEntry; isAdmin: boolean }) {
  return (
    <Link
      to={`/gambling/${c.id}`}
      className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 hover:border-emerald-500/50 transition"
    >
      <CrateIcon imageUrl={c.image_url} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-zinc-100 truncate">{c.name}</p>
          {isAdmin && !c.is_active && (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium uppercase tracking-wide">
              Archivée
            </span>
          )}
        </div>
        {c.description && <p className="text-sm text-zinc-500 truncate">{c.description}</p>}
        <p className="text-sm text-emerald-400 font-semibold mt-0.5">
          {c.cost_sp > 0 ? `${c.cost_sp} SP` : 'Gratuit'}
          {c.max_opens_per_player !== null && (
            <span className="text-zinc-500 font-normal">
              {' '}
              · {c.myOpenCount}/{c.max_opens_per_player}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
