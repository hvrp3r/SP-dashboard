-- Type de notification 'permission_granted' (organisateur d'événements nommé
-- par le MSP, migration 071) — oublié dans le CHECK, ce qui faisait échouer
-- l'attribution de la permission au moment de notifier le joueur.
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
    -- 'achievement_unlocked' a été ajouté manuellement en BDD (hors migrations du repo) :
    -- il existe au moins une notification historique de ce type, le CHECK doit le couvrir
    'achievement_unlocked'
  )
);
