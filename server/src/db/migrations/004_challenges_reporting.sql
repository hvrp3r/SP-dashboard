-- Déclarations de résultat indépendantes des deux participants d'un défi.
-- Quand les deux colonnes sont renseignées et concordent, le défi se résout
-- automatiquement. En cas de désaccord, le MSP arbitre (winner_id force le résultat).
ALTER TABLE challenges
  ADD COLUMN challenger_reported_winner_id INT REFERENCES users(id),
  ADD COLUMN challenged_reported_winner_id INT REFERENCES users(id);
