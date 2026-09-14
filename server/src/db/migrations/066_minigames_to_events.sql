-- Renommage du domaine "Mini-jeux" en "Événements" (code et UI renommés en
-- parallèle) : tables, contraintes/index, types de transactions SP, types de
-- notifications, salon de chat et liens des notifications existantes.
-- Les valeurs `game_type` ('quiz', 'flappy_bird', 'speedrun') sont conservées
-- telles quelles : ce sont des noms de jeux, pas le nom du domaine.

-- 1. Tables (les FK depuis flappy_bird_attempts / speedrun_attempts suivent
--    automatiquement : références par OID, pas par nom)
ALTER TABLE minigame_answers RENAME TO event_answers;
ALTER TABLE minigame_questions RENAME TO event_questions;
ALTER TABLE minigame_participants RENAME TO event_participants;
ALTER TABLE minigame_sessions RENAME TO event_sessions;

-- 2. Contraintes & index — RENAME TABLE ne les renomme pas
ALTER TABLE event_sessions RENAME CONSTRAINT minigame_status_valid TO event_status_valid;
ALTER TABLE event_sessions RENAME CONSTRAINT minigame_reward_1st_non_negative TO event_reward_1st_non_negative;
ALTER TABLE event_sessions RENAME CONSTRAINT minigame_reward_2nd_non_negative TO event_reward_2nd_non_negative;
ALTER TABLE event_sessions RENAME CONSTRAINT minigame_reward_3rd_non_negative TO event_reward_3rd_non_negative;
ALTER TABLE event_questions RENAME CONSTRAINT minigame_question_status_valid TO event_question_status_valid;
ALTER TABLE event_questions RENAME CONSTRAINT minigame_question_duration_positive TO event_question_duration_positive;
ALTER INDEX idx_minigame_participants_session RENAME TO idx_event_participants_session;
ALTER INDEX idx_minigame_questions_session RENAME TO idx_event_questions_session;
ALTER INDEX idx_minigame_answers_question RENAME TO idx_event_answers_question;

-- 3. Types de transactions SP — le CHECK existant bloquerait l'UPDATE vers la
--    nouvelle valeur : on le retire, on migre les données, puis on le recrée
--    (même convention que les migrations 013/032/043/045/052 : re-listage
--    complet des types à chaque réécriture)
ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
UPDATE sp_transactions SET type = 'event_reward' WHERE type = 'minigame_reward';
UPDATE sp_transactions SET type = 'event_entry' WHERE type = 'minigame_entry';
UPDATE sp_transactions SET note = 'Événement' WHERE note = 'Mini-jeu';
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (
  type IN (
    'login_bonus', 'challenge_win', 'challenge_loss', 'event_reward', 'event_entry',
    'admin_grant', 'admin_deduct', 'gambling_spend', 'gambling_win', 'gambling_refund',
    'auction_bid_hold', 'auction_bid_refund', 'auction_sale',
    'motus_reward', 'sudoku_reward'
  )
);

-- 4. Types de notifications + liens des notifications existantes pointant vers
--    l'ancienne route client
ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
UPDATE notifications SET type = 'event_open' WHERE type = 'minigame_open';
UPDATE notifications SET type = 'event_cancelled' WHERE type = 'minigame_cancelled';
UPDATE notifications SET link = REPLACE(link, '/mini-jeux/', '/evenements/')
  WHERE link LIKE '/mini-jeux/%';
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (
  type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_resolved',
    'challenge_cancelled', 'challenge_expired', 'event_open', 'sp_gained', 'sp_lost',
    'cosmetic_earned',
    'auction_outbid', 'auction_won', 'auction_sold', 'auction_expired', 'auction_cancelled',
    'event_cancelled',
    'suggestion_comment', 'suggestion_closed',
    -- 'achievement_unlocked' a été ajouté manuellement en BDD (hors migrations du repo) :
    -- il existe au moins une notification historique de ce type, le CHECK doit le couvrir
    'achievement_unlocked'
  )
);

-- 5. Salon de chat des sessions d'événement ('minigame' → 'event',
--    room_key = id de la session, inchangé)
UPDATE chat_messages SET room = 'event' WHERE room = 'minigame';

-- 6. Description de la clé Discord (texte de documentation uniquement)
UPDATE admin_config
SET description = REPLACE(description, 'mini-jeu', 'événement')
WHERE key = 'discord_notifications_enabled' AND description LIKE '%mini-jeu%';
