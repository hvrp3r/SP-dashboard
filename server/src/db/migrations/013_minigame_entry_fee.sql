-- Le MSP peut rendre une session de mini-jeu payante : une mise fixe est
-- débitée au joueur au moment où il rejoint (droit d'entrée pour accéder au
-- quiz), indépendamment des SP qui lui seront ensuite librement attribués.
-- NULL = session gratuite (comportement existant).
ALTER TABLE minigame_sessions
  ADD COLUMN entry_fee INT CHECK (entry_fee IS NULL OR entry_fee > 0);

ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (type IN (
  'login_bonus', 'challenge_win', 'challenge_loss',
  'minigame_reward', 'minigame_entry', 'admin_grant', 'admin_deduct',
  'gambling_spend', 'gambling_win'
));
