-- Tournois : nouveau type d'événement (event_sessions.game_type='tournament') —
-- même pattern que flappy_bird/speedrun : les colonnes génériques de
-- event_sessions servent de socle (entry_fee = mise d'inscription,
-- reward_1st/2nd/3rd = dotation SP par membre de l'équipe finissant 1er/2e/3e),
-- les tables tournament_* portent le spécifique (équipes tag+logo, matchs,
-- annonces). L'arbre est généré par le MSP (formats : élimination simple,
-- double élimination, round-robin), les matchs se jouent hors-plateforme et le
-- MSP déclare chaque vainqueur — l'avancement se propage automatiquement.
-- Inscription individuelle via event_participants (self-join existant) ; le
-- rating (base de l'équilibrage des équipes générées) est éditable par le MSP,
-- défaut = solde SP du joueur au moment de la génération.

ALTER TABLE event_sessions
  ADD COLUMN tournament_format VARCHAR(20),
  ADD COLUMN tournament_max_teams INT,
  ADD COLUMN tournament_team_size INT,
  ADD CONSTRAINT event_sessions_tournament_format_valid
    CHECK (tournament_format IS NULL OR tournament_format IN ('single_elim', 'double_elim', 'round_robin')),
  ADD CONSTRAINT event_sessions_tournament_max_teams_positive
    CHECK (tournament_max_teams IS NULL OR tournament_max_teams > 1),
  ADD CONSTRAINT event_sessions_tournament_team_size_positive
    CHECK (tournament_team_size IS NULL OR tournament_team_size > 0);

-- Rating de pondération d'un inscrit (utilisé uniquement par le type
-- 'tournament' — NULL = fallback sur le solde SP au moment de la génération)
ALTER TABLE event_participants
  ADD COLUMN rating INT,
  ADD CONSTRAINT event_participants_rating_non_negative CHECK (rating IS NULL OR rating >= 0);

-- Équipes : tag court unique par tournoi + logo optionnel (upload, /uploads)
CREATE TABLE tournament_teams (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES event_sessions(id),
  tag VARCHAR(8) NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, tag)
);
CREATE INDEX idx_tournament_teams_session ON tournament_teams(session_id);

-- Un joueur = au plus une équipe par tournoi (vérifié applicativement côté
-- service avant chaque insertion, comme les autres contraintes de ce genre)
CREATE TABLE tournament_team_members (
  id SERIAL PRIMARY KEY,
  team_id INT NOT NULL REFERENCES tournament_teams(id),
  user_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX idx_tournament_team_members_team ON tournament_team_members(team_id);
CREATE INDEX idx_tournament_team_members_user ON tournament_team_members(user_id);

-- Matchs : bracket 'main' (élimination simple / round-robin), 'winners'/'losers'
-- (double élimination), 'grand_final' et 'grand_final_reset' (double
-- élimination : si le représentant de la bracket losers gagne la grande finale,
-- un match de reset est créé — le représentant winners doit être battu deux
-- fois pour perdre le tournoi). Les feeds ('t:5' équipe 5, 'w:12' vainqueur du
-- match 12, 'l:12' perdant du match 12, NULL = slot de bye) décrivent
-- l'orientation de l'arbre : ils permettent à resolveMatch de propager
-- automatiquement les équipes dans les rounds suivants, les trois formats.
CREATE TABLE tournament_matches (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES event_sessions(id),
  bracket VARCHAR(20) NOT NULL DEFAULT 'main',
  round INT NOT NULL,
  position INT NOT NULL,
  feed_a TEXT,
  feed_b TEXT,
  team_a_id INT REFERENCES tournament_teams(id),
  team_b_id INT REFERENCES tournament_teams(id),
  winner_team_id INT REFERENCES tournament_teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT tournament_matches_bracket_valid
    CHECK (bracket IN ('main', 'winners', 'losers', 'grand_final', 'grand_final_reset')),
  CONSTRAINT tournament_matches_round_positive CHECK (round > 0),
  CONSTRAINT tournament_matches_position_positive CHECK (position > 0),
  UNIQUE (session_id, bracket, round, position)
);
CREATE INDEX idx_tournament_matches_session ON tournament_matches(session_id);

-- Annonces du MSP : visibles par tous les participants de la session, chaque
-- publication notifie les inscrits (type 'tournament_announcement')
CREATE TABLE tournament_announcements (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES event_sessions(id),
  author_id INT NOT NULL REFERENCES users(id),
  body VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tournament_announcements_session ON tournament_announcements(session_id);

ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (
  type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_resolved',
    'challenge_cancelled', 'challenge_expired', 'event_open', 'sp_gained', 'sp_lost',
    'cosmetic_earned',
    'auction_outbid', 'auction_won', 'auction_sold', 'auction_expired', 'auction_cancelled',
    'event_cancelled',
    'suggestion_comment', 'suggestion_closed',
    'tournament_announcement',
    -- 'achievement_unlocked' a été ajouté manuellement en BDD (hors migrations du repo) :
    -- il existe au moins une notification historique de ce type, le CHECK doit le couvrir
    'achievement_unlocked'
  )
);
