-- Likes/dislikes sur le profil d'un joueur, même pattern que le vote façon
-- Reddit des suggestions (suggestion_votes) : un vote par joueur par profil
-- cible, en bascule (revoter dans le même sens retire le vote). Contrairement
-- aux suggestions, les compteurs like/dislike sont affichés séparément (pas
-- un score net), donc pas de colonne "value" agrégée côté lecture, juste
-- COUNT(*) par direction.
CREATE TABLE profile_reactions (
  id SERIAL PRIMARY KEY,
  target_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voter_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT profile_reaction_value_valid CHECK (value IN (1, -1)),
  CONSTRAINT profile_reaction_not_self CHECK (target_user_id <> voter_id),
  UNIQUE (target_user_id, voter_id)
);

CREATE INDEX idx_profile_reactions_target ON profile_reactions(target_user_id);
