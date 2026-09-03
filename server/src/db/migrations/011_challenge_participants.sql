-- Les défis passent d'un modèle 1 vs 1 figé à un modèle à plusieurs participants
-- au sein d'un même défi : le challenger + N adversaires misent tous le même
-- montant, et le gagnant remporte le pot entier (mise x nombre de participants
-- ayant accepté). C'est une généralisation stricte du 1 vs 1 (N=2 donne
-- exactement l'ancien comportement : gagnant = mise x 2, perdant = -mise).

CREATE TABLE challenge_participants (
  id SERIAL PRIMARY KEY,
  challenge_id INT REFERENCES challenges(id),
  user_id INT REFERENCES users(id),
  is_challenger BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reported_winner_id INT REFERENCES users(id),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT challenge_participant_status_valid CHECK (status IN ('pending', 'accepted', 'declined')),
  UNIQUE (challenge_id, user_id)
);

CREATE INDEX idx_challenge_participants_challenge ON challenge_participants(challenge_id);
CREATE INDEX idx_challenge_participants_user ON challenge_participants(user_id);

-- Reprend les défis 1 vs 1 existants dans le nouveau modèle avant de supprimer
-- les anciennes colonnes. Le challenger est toujours considéré "accepted" (il
-- n'a pas besoin d'accepter son propre défi).
INSERT INTO challenge_participants (challenge_id, user_id, is_challenger, status, reported_winner_id, responded_at)
SELECT id, challenger_id, TRUE, 'accepted', challenger_reported_winner_id,
       CASE WHEN status != 'pending' THEN created_at END
FROM challenges;

INSERT INTO challenge_participants (challenge_id, user_id, is_challenger, status, reported_winner_id, responded_at)
SELECT id, challenged_id, FALSE,
       CASE
         WHEN status = 'pending' THEN 'pending'
         WHEN status = 'declined' THEN 'declined'
         WHEN status = 'expired' THEN 'declined'
         ELSE 'accepted'
       END,
       challenged_reported_winner_id,
       CASE WHEN status != 'pending' THEN created_at END
FROM challenges;

ALTER TABLE challenges
  DROP COLUMN challenged_id,
  DROP COLUMN challenger_reported_winner_id,
  DROP COLUMN challenged_reported_winner_id;
