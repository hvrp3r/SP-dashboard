-- Permet au MSP de plafonner le nombre d'ouvertures d'une caisse par joueur
-- (ex: caisse événement limitée à 3 ouvertures/joueur). NULL = illimité
-- (comportement existant, inchangé par défaut).
ALTER TABLE gambling_crates
  ADD COLUMN max_opens_per_player INT CHECK (max_opens_per_player IS NULL OR max_opens_per_player > 0);
