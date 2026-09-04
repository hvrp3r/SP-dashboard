import type { GamblingRewardType } from '../types.js';

export const REWARD_TYPE_LABELS: Record<GamblingRewardType, string> = {
  sp: 'SP',
  custom: 'Collection',
  cosmetic: 'Cosmétique',
};

export function rewardFallbackEmoji(type: GamblingRewardType): string {
  if (type === 'sp') return '🪙';
  if (type === 'cosmetic') return '✨';
  return '🎁';
}

export type RewardRarity = 'legendary' | 'rare' | 'common';

/** Paliers de rareté purement visuels, dérivés du poids de tirage normalisé. */
export function rarityFromWeightPercent(weightPercent: number): RewardRarity {
  if (weightPercent < 5) return 'legendary';
  if (weightPercent < 20) return 'rare';
  return 'common';
}

export const RARITY_RING_CLASSES: Record<RewardRarity, string> = {
  legendary: 'ring-4 ring-amber-400 shadow-lg shadow-amber-500/50',
  rare: 'ring-4 ring-violet-400 shadow-lg shadow-violet-500/40',
  common: 'ring-2 ring-emerald-400',
};

export const RARITY_TEXT_CLASSES: Record<RewardRarity, string> = {
  legendary: 'text-amber-400',
  rare: 'text-violet-400',
  common: 'text-emerald-400',
};

/** Intervalles de réinitialisation les plus courants, proposés en presets dans le formulaire de caisse. */
export const RESET_INTERVAL_PRESETS = [1, 3, 7];

/** Libellé complet, utilisé dans les formulaires MSP. */
export function resetIntervalLabel(days: number): string {
  if (days === 1) return 'Réinitialisation quotidienne';
  if (days === 7) return 'Réinitialisation hebdomadaire';
  return `Réinitialisation tous les ${days} jours`;
}

/** Libellé court, utilisé dans les cartes/compteurs affichés aux joueurs. */
export function resetIntervalShortLabel(days: number): string {
  if (days === 1) return 'reset quotidien';
  if (days === 7) return 'reset hebdo';
  return `reset tous les ${days}j`;
}

/** Complément de phrase pour "elle se réinitialise ...". */
export function resetIntervalRecurrencePhrase(days: number): string {
  if (days === 1) return 'chaque jour';
  if (days === 7) return 'chaque semaine';
  return `tous les ${days} jours`;
}
