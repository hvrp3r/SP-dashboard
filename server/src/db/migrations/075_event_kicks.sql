-- Exclusion (kick) d'un joueur d'une session d'événement par le MSP ou
-- l'organisateur de la session. Une ligne = un joueur exclu : il est retiré des
-- participants (mise remboursée), de son équipe de tournoi, ses tentatives
-- flappy/speedrun sont exclues, et il ne peut plus rejoindre ni jouer la
-- session tant que la ligne existe. Réintégrer = supprimer la ligne (comme
-- user_permissions, pas d'enjeu d'historique sur la ligne elle-même — les
-- remboursements restent tracés dans sp_transactions).
CREATE TABLE event_kicks (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES event_sessions(id),
  user_id INT NOT NULL REFERENCES users(id),
  kicked_by INT REFERENCES users(id),
  kicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_event_kicks_session ON event_kicks(session_id);

-- Remboursement de la mise d'inscription d'un joueur exclu
ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (
  type IN (
    'login_bonus', 'challenge_win', 'challenge_loss', 'event_reward', 'event_entry',
    'event_entry_refund',
    'admin_grant', 'admin_deduct', 'gambling_spend', 'gambling_win', 'gambling_refund',
    'auction_bid_hold', 'auction_bid_refund', 'auction_sale',
    'motus_reward', 'sudoku_reward'
  )
);

ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (
  type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_resolved',
    'challenge_cancelled', 'challenge_expired', 'event_open', 'sp_gained', 'sp_lost',
    'cosmetic_earned',
    'auction_outbid', 'auction_won', 'auction_sold', 'auction_expired', 'auction_cancelled',
    'event_cancelled',
    'suggestion_comment', 'suggestion_closed',
    'tournament_announcement',
    'permission_granted',
    'event_kicked',
    -- 'achievement_unlocked' a été ajouté manuellement en BDD (hors migrations du repo) :
    -- il existe au moins une notification historique de ce type, le CHECK doit le couvrir
    'achievement_unlocked'
  )
);
