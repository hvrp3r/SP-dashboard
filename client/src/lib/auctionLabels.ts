import type { AuctionStatus, AuctionBidStatus } from '../types.js';

export const AUCTION_STATUS_LABELS: Record<AuctionStatus, string> = {
  active: 'En cours',
  sold: 'Vendue',
  expired: 'Expirée',
  cancelled: 'Annulée',
};

export const AUCTION_STATUS_CLASSES: Record<AuctionStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  sold: 'bg-blue-500/15 text-blue-400',
  expired: 'bg-zinc-700/50 text-zinc-400',
  cancelled: 'bg-red-500/15 text-red-400',
};

export const AUCTION_BID_STATUS_LABELS: Record<AuctionBidStatus, string> = {
  active: 'Offre actuelle',
  refunded: 'Remboursée',
  won: 'Gagnante',
};

/** Formate le temps restant avant `endsAt` — ex: "2h 14min", "38min", "Terminée". */
export function formatTimeRemaining(endsAt: string, now: number = Date.now()): string {
  const diffMs = new Date(endsAt).getTime() - now;
  if (diffMs <= 0) return 'Terminée';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}j ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}
