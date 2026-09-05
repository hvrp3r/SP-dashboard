-- Permet au MSP d'annuler une session de mini-jeu Flappy Bird pendant qu'elle est
-- encore ouverte (avant sa date limite ou en attente de clôture), sans distribuer
-- aucun gain — même principe que l'annulation d'un défi (migration 009) : un statut
-- 'cancelled' distinct de 'closed' (qui reste réservé à une clôture normale, avec
-- distribution), plus cancelled_at/cancelled_by pour la traçabilité.
ALTER TABLE minigame_sessions
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancelled_by INT REFERENCES users(id);

ALTER TABLE minigame_sessions DROP CONSTRAINT minigame_status_valid;
ALTER TABLE minigame_sessions ADD CONSTRAINT minigame_status_valid
  CHECK (status IN ('open', 'closed', 'cancelled'));

ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (
  type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_resolved',
    'challenge_cancelled', 'challenge_expired', 'minigame_open', 'sp_gained', 'sp_lost',
    'cosmetic_earned',
    'auction_outbid', 'auction_won', 'auction_sold', 'auction_expired', 'auction_cancelled',
    'minigame_cancelled'
  )
);
