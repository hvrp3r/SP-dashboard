export interface ConfigSection {
  title: string;
  keys: string[];
}

export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    title: 'Connexion quotidienne & Streak',
    keys: ['login_bonus_base', 'streak_bonus_step', 'streak_bonus_max', 'streak_required_days'],
  },
  {
    title: 'Défis',
    keys: ['max_wager_amount', 'max_challenges_per_day'],
  },
  {
    title: 'Gambling',
    keys: ['gambling_enabled', 'blackjack_enabled', 'gambling_max_wager_per_day'],
  },
  {
    title: 'Cosmétiques',
    keys: [
      'cosmetic_rarity_weight_common',
      'cosmetic_rarity_weight_uncommon',
      'cosmetic_rarity_weight_rare',
      'cosmetic_rarity_weight_epic',
      'cosmetic_rarity_weight_legendary',
    ],
  },
  {
    title: 'Enchères',
    keys: ['auction_min_duration_minutes', 'auction_max_duration_minutes', 'auction_min_bid_increment'],
  },
  {
    title: 'Intégrations',
    keys: ['discord_notifications_enabled'],
  },
  {
    title: 'Abonnements',
    keys: ['kofi_subscription_period_days'],
  },
];
