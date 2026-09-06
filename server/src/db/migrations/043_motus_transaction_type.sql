-- La contrainte CHECK sur sp_transactions.type (dernière mise à jour en 032
-- pour les enchères) n'incluait pas le nouveau type 'motus_reward' ajouté
-- côté TypeScript par 042_motus.sql — même oubli que celui corrigé par 032
-- pour les enchères, cf. son commentaire.
ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (
  type IN (
    'login_bonus', 'challenge_win', 'challenge_loss', 'minigame_reward', 'minigame_entry',
    'admin_grant', 'admin_deduct', 'gambling_spend', 'gambling_win',
    'auction_bid_hold', 'auction_bid_refund', 'auction_sale',
    'motus_reward'
  )
);
