import type { GamblingRewardType } from '../types.js';

export const REWARD_TYPE_LABELS: Record<GamblingRewardType, string> = {
  sp: 'SP',
  custom: 'Collection',
};

export function rewardFallbackEmoji(type: GamblingRewardType): string {
  return type === 'sp' ? '🪙' : '🎁';
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
