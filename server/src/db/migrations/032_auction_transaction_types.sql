-- La migration 031 a ajouté les types 'auction_bid_hold', 'auction_bid_refund'
-- et 'auction_sale' côté TypeScript, mais la contrainte CHECK sur
-- sp_transactions.type n'avait pas été mise à jour — un oubli qui bloquait
-- toute enchère avec une violation de contrainte. Même oubli sur
-- notifications.type pour les 5 nouveaux types de notification d'enchère.
ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (
  type IN (
    'login_bonus', 'challenge_win', 'challenge_loss', 'minigame_reward', 'minigame_entry',
    'admin_grant', 'admin_deduct', 'gambling_spend', 'gambling_win',
    'auction_bid_hold', 'auction_bid_refund', 'auction_sale'
  )
);

ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (
  type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_resolved',
    'challenge_cancelled', 'challenge_expired', 'minigame_open', 'sp_gained', 'sp_lost',
    'cosmetic_earned',
    'auction_outbid', 'auction_won', 'auction_sold', 'auction_expired', 'auction_cancelled'
  )
);
