import type { CSSProperties } from 'react';
import type { BlackjackCard } from '../types.js';

const SUIT_SYMBOLS: Record<BlackjackCard['suit'], string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const RED_SUITS: BlackjackCard['suit'][] = ['H', 'D'];

interface PlayingCardProps {
  card: BlackjackCard | null;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}

export default function PlayingCard({ card, size = 'md', style }: PlayingCardProps) {
  const dims = size === 'sm' ? 'w-9 h-12 text-xs' : 'w-12 h-16 text-sm';

  if (!card) {
    return (
      <div
        style={style}
        className={`${dims} rounded-md bg-gradient-to-br from-zinc-700 to-zinc-800 border border-zinc-600 flex-shrink-0`}
      />
    );
  }

  const isRed = RED_SUITS.includes(card.suit);

  return (
    <div
      style={style}
      className={`${dims} rounded-md bg-zinc-50 border border-zinc-300 flex-shrink-0 flex flex-col items-center justify-center leading-none font-bold ${
        isRed ? 'text-red-600' : 'text-zinc-900'
      }`}
    >
      <span>{card.rank}</span>
      <span>{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  );
}
