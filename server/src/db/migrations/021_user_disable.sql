-- Permet au MSP de désactiver un compte joueur plutôt que de le supprimer : préserve
-- tout l'historique (transactions, défis, season_snapshots continuent d'afficher son
-- pseudo) tout en lui bloquant l'accès (login + refresh refusés) et en le masquant du
-- classement/de la sélection d'adversaire, sur le même principe que
-- is_leaderboard_hidden. Jamais de suppression, réversible par le MSP.
ALTER TABLE users
  ADD COLUMN disabled_at TIMESTAMPTZ,
  ADD COLUMN disabled_by INT REFERENCES users(id);
