-- Permet au MSP de se rendre invisible du classement (leaderboard, archives de
-- saison, calcul de rang des autres joueurs). Son profil et ses transactions
-- restent consultables, seule sa présence dans les classements est masquée.
ALTER TABLE users ADD COLUMN is_leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;
