-- Ajoute 'gambling_refund' aux types de sp_transactions valides — remboursement
-- de l'entrée d'une bataille de caisses annulée pendant qu'elle attendait encore
-- des joueurs (voir gamblingBattle.service.ts#cancelBattle). Distinct de
-- 'gambling_win' (un vrai gain) pour ne pas gonfler sp_total_earned : un
-- remboursement rend seulement ce qui avait été débité, comme
-- 'auction_bid_refund' pour les enchères.
ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (
  type IN (
    'login_bonus', 'challenge_win', 'challenge_loss', 'minigame_reward', 'minigame_entry',
    'admin_grant', 'admin_deduct', 'gambling_spend', 'gambling_win', 'gambling_refund',
    'auction_bid_hold', 'auction_bid_refund', 'auction_sale',
    'motus_reward', 'sudoku_reward'
  )
);
