-- Équipes formées par les joueurs eux-mêmes (option choisie à la création du
-- tournoi). Quand le flag est actif, chaque inscrit peut créer une équipe, en
-- rejoindre une ou la quitter tant que l'arbre n'est pas généré — le MSP /
-- l'organisateur garde tous ses contrôles en parallèle.
ALTER TABLE event_sessions
  ADD COLUMN tournament_player_teams BOOLEAN NOT NULL DEFAULT FALSE;

-- Joueur qui a créé l'équipe (capitaine : peut renommer / changer le logo).
-- NULL = équipe créée par le MSP/organisateur ou par la génération aléatoire.
-- Une équipe créée par un joueur est supprimée quand son dernier membre la quitte.
ALTER TABLE tournament_teams
  ADD COLUMN created_by INT REFERENCES users(id);
