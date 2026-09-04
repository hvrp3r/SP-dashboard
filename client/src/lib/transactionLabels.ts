import type { SpTransactionType } from '../types.js';

export const TRANSACTION_TYPE_LABELS: Record<SpTransactionType, string> = {
  login_bonus: 'Bonus de connexion',
  challenge_win: 'Défi gagné',
  challenge_loss: 'Défi perdu',
  minigame_reward: 'Récompense mini-jeu',
  minigame_entry: 'Entrée mini-jeu',
  admin_grant: 'Ajustement MSP',
  admin_deduct: 'Ajustement MSP',
  gambling_spend: 'Mise gambling',
  gambling_win: 'Gain gambling',
};
