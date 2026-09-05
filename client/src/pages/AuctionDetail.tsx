import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import * as auctionsApi from '../api/auctions.js';
import CosmeticPreview from '../components/CosmeticPreview.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import { RARITY_LABELS, RARITY_TEXT_CLASSES } from '../lib/cosmeticsLabels.js';
import {
  AUCTION_BID_STATUS_LABELS,
  AUCTION_STATUS_CLASSES,
  AUCTION_STATUS_LABELS,
  formatTimeRemaining,
} from '../lib/auctionLabels.js';
import type { AuctionDetail as AuctionDetailData } from '../types.js';

const POLL_INTERVAL_MS = 5000;
const TICK_INTERVAL_MS = 1000;

const BID_STATUS_CLASSES: Record<string, string> = {
  won: 'bg-emerald-500/15 text-emerald-400',
  refunded: 'bg-zinc-700/50 text-zinc-400',
  active: 'bg-blue-500/15 text-blue-400',
};

export default function AuctionDetail() {
  const { id } = useParams<{ id: string }>();
  const auctionId = Number(id);
  const { user } = useAuth();
  const confirm = useConfirm();

  const [auction, setAuction] = useState<AuctionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(Date.now());

  async function load() {
    try {
      const data = await auctionsApi.getById(auctionId);
      setAuction(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionId]);

  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, []);

  async function handleBid(e: FormEvent) {
    e.preventDefault();
    if (!bidAmount) return;
    setError(null);
    setSubmitting(true);
    try {
      await auctionsApi.placeBid(auctionId, Number(bidAmount));
      setBidAmount('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    const ok = await confirm({
      title: 'Annuler cette enchère ?',
      message: "Le SP du plus offrant (s'il y en a un) sera remboursé. Cette action est irréversible.",
      danger: true,
      confirmLabel: "Annuler l'enchère",
    });
    if (!ok) return;
    setCancelling(true);
    setError(null);
    try {
      await auctionsApi.cancel(auctionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCancelling(false);
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

  if (!auction) {
    return (
      <div className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-400 mb-3">{error ?? 'Enchère introuvable'}</p>
          <Link to="/encheres" className="text-sm text-emerald-400 hover:underline">
            ← Retour aux enchères
          </Link>
        </div>
      </div>
    );
  }

  const isSeller = auction.seller_id === user.id;
  const isWinning = auction.current_bidder_id === user.id;
  const minRequired = (auction.current_bid ?? auction.starting_price) + (auction.current_bid !== null ? 1 : 0);
  const canBid = auction.status === 'active' && !isSeller && !isWinning;

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/encheres" className="text-sm text-zinc-500 hover:text-zinc-300 mb-4 inline-block">
          ← Enchères
        </Link>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <div className="flex items-start gap-4">
            <CosmeticPreview cosmetic={auction.cosmetic} size={96} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h1 className="text-xl font-bold text-zinc-50 truncate">{auction.cosmetic.name}</h1>
                <span
                  className={`flex-shrink-0 text-xs px-2 py-1 rounded-full ${AUCTION_STATUS_CLASSES[auction.status]}`}
                >
                  {AUCTION_STATUS_LABELS[auction.status]}
                </span>
              </div>
              <p className={`text-sm font-medium ${RARITY_TEXT_CLASSES[auction.cosmetic.rarity]}`}>
                {RARITY_LABELS[auction.cosmetic.rarity]}
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                Vendeur :{' '}
                <UserNameTag username={auction.seller_username} equipped={auction.seller_equipped_cosmetics} />
              </p>
              {auction.status === 'active' && (
                <p className="text-sm text-zinc-400 mt-1">
                  Temps restant : {formatTimeRemaining(auction.ends_at, now)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-400">
              {auction.current_bid ?? auction.starting_price} SP
            </span>
            <span className="text-sm text-zinc-500">
              {auction.current_bid !== null && auction.current_bidder_username ? (
                <>
                  enchère actuelle ·{' '}
                  <UserNameTag
                    username={auction.current_bidder_username}
                    equipped={auction.current_bidder_equipped_cosmetics}
                    className="text-zinc-500"
                  />
                </>
              ) : (
                'prix de départ · aucune offre'
              )}
            </span>
          </div>

          {isWinning && auction.status === 'active' && (
            <p className="mt-2 text-sm text-emerald-400 font-medium">
              Tu es actuellement le plus offrant.
            </p>
          )}
          {isSeller && <p className="mt-2 text-sm text-zinc-500">C'est ta propre enchère.</p>}

          {canBid && (
            <form onSubmit={handleBid} className="mt-4 flex gap-2">
              <input
                type="number"
                min={minRequired}
                required
                placeholder={`Min. ${minRequired} SP`}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={submitting}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                {submitting ? '…' : 'Enchérir'}
              </button>
            </form>
          )}

          {user.role === 'admin' && auction.status === 'active' && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="mt-4 text-sm bg-red-500/15 hover:bg-red-500/25 text-red-400 font-medium px-3 py-1.5 rounded-md transition disabled:opacity-50"
            >
              {cancelling ? '…' : "Annuler l'enchère (MSP)"}
            </button>
          )}
        </div>

        <h2 className="font-semibold text-zinc-200 mb-3">Historique des offres</h2>
        {auction.bids.length === 0 ? (
          <p className="text-zinc-500 text-sm">Aucune offre pour le moment.</p>
        ) : (
          <div className="space-y-2">
            {auction.bids.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <UserNameTag username={b.bidder_username} equipped={b.bidder_equipped_cosmetics} className="text-zinc-200" />
                  <span className="text-xs text-zinc-500 ml-2">
                    {new Date(b.created_at).toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-medium text-zinc-100">{b.amount} SP</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${BID_STATUS_CLASSES[b.status]}`}>
                    {AUCTION_BID_STATUS_LABELS[b.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
