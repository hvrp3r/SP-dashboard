-- Page "Suggestions" : les joueurs proposent des features ou signalent des bugs,
-- votent (upvote façon Reddit, un vote par joueur par suggestion) et commentent.
-- Le MSP peut clôturer une suggestion (traitée, conserve l'historique) ou la
-- supprimer entièrement (contrairement aux autres ressources de l'app, pas
-- d'enjeu SP/historique économique à préserver ici) — ON DELETE CASCADE
-- nettoie alors votes et commentaires.
CREATE TABLE suggestions (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES users(id),
  type VARCHAR(20) NOT NULL DEFAULT 'feature',
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  closed_at TIMESTAMPTZ,
  closed_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT suggestion_type_valid CHECK (type IN ('feature', 'bug')),
  CONSTRAINT suggestion_status_valid CHECK (status IN ('open', 'closed'))
);

CREATE TABLE suggestion_votes (
  id SERIAL PRIMARY KEY,
  suggestion_id INT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (suggestion_id, user_id)
);

CREATE TABLE suggestion_comments (
  id SERIAL PRIMARY KEY,
  suggestion_id INT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  author_id INT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_suggestion_votes_suggestion ON suggestion_votes(suggestion_id);
CREATE INDEX idx_suggestion_comments_suggestion ON suggestion_comments(suggestion_id);
CREATE INDEX idx_suggestions_status ON suggestions(status);

ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (
  type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_resolved',
    'challenge_cancelled', 'challenge_expired', 'minigame_open', 'sp_gained', 'sp_lost',
    'cosmetic_earned',
    'auction_outbid', 'auction_won', 'auction_sold', 'auction_expired', 'auction_cancelled',
    'minigame_cancelled',
    'suggestion_comment', 'suggestion_closed'
  )
);
