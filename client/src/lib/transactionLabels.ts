import type { SpTransactionType } from '../types.js';

export const TRANSACTION_TYPE_LABELS: Record<SpTransactionType, string> = {
  login_bonus: 'Bonus de connexion',
  challenge_win: 'Défi gagné',
  challenge_loss: 'Défi perdu',
  event_reward: 'Récompense événement',
  event_entry: 'Entrée événement',
  admin_grant: 'Ajustement MSP',
  admin_deduct: 'Ajustement MSP',
  gambling_spend: 'Mise gambling',
  gambling_win: 'Gain gambling',
  gambling_refund: 'Remboursement gambling',
  auction_bid_hold: 'Enchère — mise bloquée',
  auction_bid_refund: 'Enchère — mise remboursée',
  auction_sale: 'Vente aux enchères',
  motus_reward: 'Récompense Motus',
  sudoku_reward: 'Récompense Sudoku',
};
