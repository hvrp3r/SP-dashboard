-- Les mini-jeux deviennent interactifs : les joueurs rejoignent eux-mêmes la
-- session, le MSP diffuse une question à la fois en direct, et les SP sont
-- attribués librement par le MSP après coup (montant libre par joueur).
-- Le classement par rang (1er/2e/3e) et les récompenses fixes associées
-- n'existent donc plus.

ALTER TABLE minigame_participants
  DROP COLUMN rank,
  ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE minigame_questions (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES minigame_sessions(id),
  prompt TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  CONSTRAINT minigame_question_status_valid CHECK (status IN ('active', 'closed'))
);

CREATE TABLE minigame_answers (
  id SERIAL PRIMARY KEY,
  question_id INT REFERENCES minigame_questions(id),
  user_id INT REFERENCES users(id),
  answer_text TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (question_id, user_id)
);

CREATE INDEX idx_minigame_questions_session ON minigame_questions(session_id);
CREATE INDEX idx_minigame_answers_question ON minigame_answers(question_id);

-- Ces montants fixes par rang ne sont plus utilisés : l'attribution des SP
-- est désormais un montant libre choisi par le MSP pour chaque joueur.
DELETE FROM admin_config WHERE key IN ('minigame_reward_1st', 'minigame_reward_2nd', 'minigame_reward_3rd');
