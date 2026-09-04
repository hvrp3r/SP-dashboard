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
    title: 'Intégrations',
    keys: ['discord_notifications_enabled'],
  },
  {
    title: 'Abonnements',
    keys: ['kofi_subscription_period_days'],
  },
];
