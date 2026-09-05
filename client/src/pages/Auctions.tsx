import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as auctionsApi from '../api/auctions.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import CosmeticPreview from '../components/CosmeticPreview.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import {
  AUCTION_STATUS_CLASSES,
  AUCTION_STATUS_LABELS,
  formatTimeRemaining,
} from '../lib/auctionLabels.js';
import type { AuctionEntry, UserCosmeticEntry } from '../types.js';

const POLL_INTERVAL_MS = 5000;
const TICK_INTERVAL_MS = 1000;
/** Suggestions de durée en minutes (boutons de remplissage rapide) — le champ
 * reste un nombre de minutes libre, pas une liste fermée de presets. */
const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: '5min', minutes: 5 },
  { label: '30min', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
  { label: '3j', minutes: 4320 },
];

export default function Auctions() {
  const { user } = useAuth();
  const [auctions, setAuctions] = useState<AuctionEntry[]>([]);
  const [selling, setSelling] = useState<AuctionEntry[]>([]);
  const [bidding, setBidding] = useState<AuctionEntry[]>([]);
  const [owned, setOwned] = useState<UserCosmeticEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [selectedCosmeticId, setSelectedCosmeticId] = useState('');
  const [startingPrice, setStartingPrice] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('1440');
  const [submitting, setSubmitting] = useState(false);

  async function loadAuctions() {
    try {
      const data = await auctionsApi.listActive();
      setAuctions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  async function loadActivity() {
    try {
      const activity = await auctionsApi.getMyActivity();
      setSelling(activity.selling);
      setBidding(activity.bidding);
    } catch {
      // pas bloquant pour l'affichage de la liste principale
    }
  }

  useEffect(() => {
    loadAuctions();
    loadActivity();
    cosmeticsApi
      .getMine()
      .then((mine) => setOwned(mine.owned))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      loadAuctions();
      loadActivity();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, []);

  // Exemplaires disponibles = possédés moins ceux déjà mis en enchère
  // (active) — un même cosmétique en double peut être vendu plusieurs fois
  // séparément, mais pas plus de fois qu'il n'en reste en stock.
  const activeListingCounts = new Map<number, number>();
  for (const a of selling) {
    if (a.status === 'active') {
      activeListingCounts.set(a.cosmetic_id, (activeListingCounts.get(a.cosmetic_id) ?? 0) + 1);
    }
  }
  const sellable = owned
    .filter((o) => !o.cosmetic.is_default)
    .map((o) => ({ ...o, available: o.quantity - (activeListingCounts.get(o.cosmetic_id) ?? 0) }))
    .filter((o) => o.available > 0);

  const selectedSellable = sellable.find((o) => String(o.cosmetic_id) === selectedCosmeticId);
  const sellingLastEquippedCopy =
    selectedSellable !== undefined && selectedSellable.equipped && selectedSellable.available === 1;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!selectedCosmeticId || !startingPrice || !durationMinutes) return;
    setError(null);
    setSubmitting(true);
    try {
      await auctionsApi.create({
        cosmeticId: Number(selectedCosmeticId),
        startingPrice: Number(startingPrice),
        durationMinutes: Number(durationMinutes),
      });
      setSelectedCosmeticId('');
      setStartingPrice('');
      await loadAuctions();
      await loadActivity();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-zinc-500">Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-1">Enchères</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Mets en enchère tes cosmétiques (même un exemplaire unique), ou enchéris sur ceux des
          autres joueurs.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Mettre en enchère</h2>
          {sellable.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Tu n'as aucun cosmétique disponible à vendre pour l'instant.
            </p>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
              <select
                required
                value={selectedCosmeticId}
                onChange={(e) => setSelectedCosmeticId(e.target.value)}
                className="flex-1 min-w-[200px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Choisir un cosmétique…</option>
                {sellable.map((o) => (
                  <option key={o.cosmetic_id} value={o.cosmetic_id}>
                    {o.cosmetic.name} ({o.available} disponible{o.available > 1 ? 's' : ''})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                required
                placeholder="Prix de départ (SP)"
                value={startingPrice}
                onChange={(e) => setStartingPrice(e.target.value)}
                className="w-40 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <input
                type="number"
                min={1}
                required
                placeholder="Durée (minutes)"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-36 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={submitting}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Mettre en enchère
              </button>
              <div className="w-full flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.minutes}
                    onClick={() => setDurationMinutes(String(p.minutes))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                      durationMinutes === String(p.minutes)
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {sellingLastEquippedCopy && (
                <p className="w-full text-xs text-amber-400">
                  C'est ton dernier exemplaire, actuellement équipé — s'il est vendu, tu retomberas
                  automatiquement sur le défaut de l'emplacement.
                </p>
              )}
            </form>
          )}
        </div>

        <h2 className="font-semibold text-zinc-200 mb-3">Enchères en cours</h2>
        <div className="space-y-3 mb-8">
          {auctions.length === 0 ? (
            <p className="text-zinc-500">Aucune enchère en cours.</p>
          ) : (
            auctions.map((a) => <AuctionCard key={a.id} auction={a} now={now} />)
          )}
        </div>

        {(selling.length > 0 || bidding.length > 0) && (
          <div>
            <h2 className="font-semibold text-zinc-200 mb-3">Mon activité</h2>
            {selling.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase text-zinc-500 mb-2">Mes ventes</p>
                <div className="space-y-2">
                  {selling.map((a) => (
                    <ActivityRow key={a.id} auction={a} />
                  ))}
                </div>
              </div>
            )}
            {bidding.length > 0 && (
              <div>
                <p className="text-xs uppercase text-zinc-500 mb-2">Mes offres</p>
                <div className="space-y-2">
                  {bidding.map((a) => (
                    <ActivityRow key={a.id} auction={a} userId={user.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AuctionCard({ auction: a, now }: { auction: AuctionEntry; now: number }) {
  return (
    <Link
      to={`/encheres/${a.id}`}
      className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 hover:border-zinc-700 transition"
    >
      <CosmeticPreview cosmetic={a.cosmetic} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-100 truncate">{a.cosmetic.name}</p>
        <p className="text-xs text-zinc-500">
          Vendeur : <UserNameTag username={a.seller_username} equipped={a.seller_equipped_cosmetics} />
        </p>
        <p className="text-sm text-zinc-300 mt-0.5">
          {a.current_bid ?? a.starting_price} SP
          {a.bid_count > 0 && (
            <span className="text-zinc-500">
              {' '}
              · {a.bid_count} offre{a.bid_count > 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>
      <span className="flex-shrink-0 text-xs font-medium text-zinc-400">
        {formatTimeRemaining(a.ends_at, now)}
      </span>
    </Link>
  );
}

function ActivityRow({ auction: a, userId }: { auction: AuctionEntry; userId?: number }) {
  const winning = userId !== undefined && a.current_bidder_id === userId;
  return (
    <Link
      to={`/encheres/${a.id}`}
      className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 hover:border-zinc-700 transition"
    >
      <span className="text-sm text-zinc-200 truncate">{a.cosmetic.name}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        {winning && a.status === 'active' && (
          <span className="text-xs text-emerald-400 font-medium">Tu mènes</span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full ${AUCTION_STATUS_CLASSES[a.status]}`}>
          {AUCTION_STATUS_LABELS[a.status]}
        </span>
      </div>
    </Link>
  );
}
