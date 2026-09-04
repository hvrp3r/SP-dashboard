import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import PlayingCard from './PlayingCard.jsx';
import Avatar from './Avatar.jsx';
import * as sound from '../lib/sound.js';
import type { BlackjackHand } from '../types.js';

const OUTCOME_LABELS: Record<string, string> = {
  win: 'Gagné',
  blackjack: 'Blackjack !',
  push: 'Égalité',
  lose: 'Perdu',
};

const PULSE_MS = 380;

function secondsUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

interface BlackjackSeatProps {
  hand: BlackjackHand;
  isMe: boolean;
  isCurrentTurn: boolean;
  now: number;
  /** Direction du centre de la table vers ce siège (pour l'animation "carte distribuée"). */
  dealOrigin: { dx: number; dy: number };
  seatIndex: number;
}

export default function BlackjackSeat({
  hand,
  isMe,
  isCurrentTurn,
  now,
  dealOrigin,
  seatIndex,
}: BlackjackSeatProps) {
  const prevCardCount = useRef(0);
  const dealtCount = hand.cards.length;
  const newFrom = prevCardCount.current;

  // Petit "pop" de juice — à l'arrivée du siège (nouveau joueur), quand son tour
  // démarre, et quand son résultat tombe. Un seul mécanisme pour les trois.
  const [pulse, setPulse] = useState(true);
  const pulseTimer = useRef<ReturnType<typeof setTimeout>>();
  const prevIsCurrentTurn = useRef(isCurrentTurn);
  const prevOutcome = useRef(hand.outcome);

  function firePulse() {
    setPulse(true);
    clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(false), PULSE_MS);
  }

  useEffect(() => {
    // pop d'entrée au montage (nouveau joueur assis)
    pulseTimer.current = setTimeout(() => setPulse(false), PULSE_MS);
    return () => clearTimeout(pulseTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isCurrentTurn && !prevIsCurrentTurn.current) {
      if (isMe) sound.playYourTurn();
      firePulse();
    }
    prevIsCurrentTurn.current = isCurrentTurn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentTurn]);

  useEffect(() => {
    if (hand.outcome && !prevOutcome.current) {
      firePulse();
    }
    prevOutcome.current = hand.outcome;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.outcome]);

  useEffect(() => {
    const from = prevCardCount.current;
    if (dealtCount > from) {
      for (let i = from; i < dealtCount; i++) {
        sound.playCardDeal((seatIndex * 120 + i * 150) / 1000);
      }
    }
    prevCardCount.current = dealtCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealtCount]);

  const total = hand.cards.reduce((sum, c) => {
    if (c.rank === 'A') return sum + 11;
    if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return sum + 10;
    return sum + Number(c.rank);
  }, 0);
  let aces = hand.cards.filter((c) => c.rank === 'A').length;
  let adjustedTotal = total;
  while (adjustedTotal > 21 && aces > 0) {
    adjustedTotal -= 10;
    aces -= 1;
  }

  const deadlineLeft =
    isCurrentTurn && hand.status === 'playing' && hand.action_deadline
      ? secondsUntil(hand.action_deadline, now)
      : null;

  const waitingForTurn = hand.status === 'playing' && !isCurrentTurn;

  return (
    <div
      style={pulse ? { animation: `popIn ${PULSE_MS}ms ease-out` } : undefined}
      className={`w-40 rounded-xl border p-2.5 bg-zinc-900/95 backdrop-blur-sm transition-shadow ${
        isCurrentTurn
          ? 'border-emerald-400 shadow-lg shadow-emerald-500/30'
          : isMe
            ? 'border-emerald-500/40'
            : 'border-zinc-800'
      }`}
    >
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar username={hand.username} avatarUrl={hand.avatar_url} size={20} />
          <p className="text-sm font-semibold text-zinc-100 truncate">
            {isMe ? 'Toi' : hand.username}
          </p>
        </div>
        <span className="text-xs text-zinc-400 flex-shrink-0">{hand.bet_amount} SP</span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1 mb-1.5 min-h-[3rem]">
        {hand.cards.map((c, i) => {
          const isNew = i >= newFrom;
          const style: CSSProperties | undefined = isNew
            ? ({
                '--deal-dx': `${dealOrigin.dx}px`,
                '--deal-dy': `${dealOrigin.dy}px`,
                animation: `dealCard 0.35s ease-out backwards`,
                animationDelay: `${seatIndex * 120 + i * 150}ms`,
              } as CSSProperties)
            : undefined;
          return <PlayingCard key={i} card={c} size="sm" style={style} />;
        })}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-100 font-semibold">
          {dealtCount > 0 ? adjustedTotal : '—'}
          {deadlineLeft !== null && (
            <span className="text-emerald-400 font-semibold ml-1">{deadlineLeft}s</span>
          )}
        </span>
        {hand.status === 'busted' && <span className="text-red-400 font-bold">Dépassé</span>}
        {waitingForTurn && !hand.outcome && (
          <span className="text-zinc-400 text-xs">En attente</span>
        )}
        {hand.outcome && (
          <span
            className={`font-bold ${hand.outcome === 'lose' ? 'text-red-400' : 'text-emerald-400'}`}
          >
            {OUTCOME_LABELS[hand.outcome]}
          </span>
        )}
      </div>
    </div>
  );
}
