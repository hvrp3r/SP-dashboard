-- Vote façon Reddit complet (up + down), pas seulement l'upvote de la migration 036 :
-- chaque ligne de suggestion_votes porte désormais sa direction, le score d'une
-- suggestion devient SUM(value) plutôt que COUNT(*).
ALTER TABLE suggestion_votes ADD COLUMN value SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE suggestion_votes ADD CONSTRAINT suggestion_vote_value_valid CHECK (value IN (1, -1));
ALTER TABLE suggestion_votes ALTER COLUMN value DROP DEFAULT;
