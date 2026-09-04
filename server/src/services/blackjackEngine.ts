import type { BlackjackCard } from '../types.js';

const RANKS: BlackjackCard['rank'][] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
];
const SUITS: BlackjackCard['suit'][] = ['S', 'H', 'D', 'C'];

/**
 * Tirage indépendant avec remise, uniforme sur les 13 rangs — mathématiquement
 * équivalent aux probabilités d'un sabot à un seul jeu de 52 cartes (chaque
 * rang y est représenté par exactement 4 cartes/13). Pas de sabot fini partagé
 * entre les mains : chaque main tire indépendamment, ce qui évite toute la
 * complexité d'un sabot commun à plusieurs joueurs simultanés.
 */
export function drawCard(): BlackjackCard {
  const rank = RANKS[Math.floor(Math.random() * RANKS.length)] as BlackjackCard['rank'];
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)] as BlackjackCard['suit'];
  return { rank, suit };
}

export function cardValue(rank: BlackjackCard['rank']): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

/** Meilleur total <= 21 possible, en comptant les As comme 11 ou 1. */
export function handTotal(cards: BlackjackCard[]): number {
  let total = cards.reduce((sum, c) => sum + cardValue(c.rank), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isBlackjack(cards: BlackjackCard[]): boolean {
  return cards.length === 2 && handTotal(cards) === 21;
}

export function isBust(cards: BlackjackCard[]): boolean {
  return handTotal(cards) > 21;
}

/** Règle standard : le croupier tire tant que son total est < 17, sinon reste. */
export function dealerShouldHit(cards: BlackjackCard[]): boolean {
  return handTotal(cards) < 17;
}
