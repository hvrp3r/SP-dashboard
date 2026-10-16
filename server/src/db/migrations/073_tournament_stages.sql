-- Plusieurs arbres ("stages") au sein d'un même tournoi, avec les mêmes équipes.
-- Chaque arbre a son propre format ; le placement de chaque équipe dans un arbre
-- terminé rapporte des points (barème tournament_placement_points), et la
-- dotation reward_1st/2nd/3rd est distribuée sur le classement général (somme
-- des points) quand le MSP termine le tournoi — plus à la fin d'un arbre.
CREATE TABLE tournament_stages (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES event_sessions(id),
  name VARCHAR(100) NOT NULL,
  format VARCHAR(20) NOT NULL,
  position INT NOT NULL,                 -- ordre d'affichage / de création (1, 2, 3…)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,               -- renseigné à la résolution du dernier match de l'arbre
  CONSTRAINT tournament_stages_format_valid
    CHECK (format IN ('single_elim', 'double_elim', 'round_robin')),
  CONSTRAINT tournament_stages_position_positive CHECK (position > 0),
  UNIQUE (session_id, position)
);
CREATE INDEX idx_tournament_stages_session ON tournament_stages(session_id);

-- Barème de points par place : index 0 = 1re place, 1 = 2e… ; une place au-delà
-- du barème rapporte 0. Les ex-aequo d'un arbre (ex : demi-finalistes) prennent
-- les points de leur place commune.
ALTER TABLE event_sessions
  ADD COLUMN tournament_placement_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN tournament_finished_at TIMESTAMPTZ;

-- Tournois existants : barème par défaut (un barème vide mettrait toutes les
-- équipes ex-aequo à 0 point, donc toutes 1res du classement général)
UPDATE event_sessions
SET tournament_placement_points = '[10, 7, 5, 3, 2, 1]'::jsonb
WHERE game_type = 'tournament';

ALTER TABLE tournament_matches ADD COLUMN stage_id INT REFERENCES tournament_stages(id);

-- Reprise de l'existant : un arbre unique par tournoi qui avait déjà des matchs
INSERT INTO tournament_stages (session_id, name, format, position, created_at)
SELECT m.session_id, 'Arbre 1', COALESCE(s.tournament_format, 'single_elim'), 1, MIN(m.created_at)
FROM tournament_matches m
JOIN event_sessions s ON s.id = m.session_id
GROUP BY m.session_id, s.tournament_format;

UPDATE tournament_matches m
SET stage_id = st.id
FROM tournament_stages st
WHERE st.session_id = m.session_id;

-- L'ancien système versait la dotation dès le dernier match : un tournoi déjà
-- clôturé ou ayant déjà versé des SP est considéré terminé, pour ne jamais
-- redistribuer une dotation.
UPDATE event_sessions s
SET tournament_finished_at = NOW()
WHERE s.game_type = 'tournament'
  AND EXISTS (SELECT 1 FROM tournament_matches m WHERE m.session_id = s.id)
  AND (
    s.status <> 'open'
    OR EXISTS (
      SELECT 1 FROM sp_transactions t
      WHERE t.type = 'event_reward' AND t.related_id = s.id
    )
  );

ALTER TABLE tournament_matches ALTER COLUMN stage_id SET NOT NULL;
ALTER TABLE tournament_matches DROP CONSTRAINT tournament_matches_session_id_bracket_round_position_key;
ALTER TABLE tournament_matches ADD CONSTRAINT tournament_matches_stage_slot_key
  UNIQUE (stage_id, bracket, round, position);
CREATE INDEX idx_tournament_matches_stage ON tournament_matches(stage_id);
