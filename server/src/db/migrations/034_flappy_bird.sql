-- Ajoute le support du mini-jeu "Flappy Bird" (NanoForge, jeu solo embarqué en iframe,
-- scores soumis par le client sans anti-triche v1, classement par meilleur score,
-- distribution manuelle par le MSP une fois la deadline passée). Colonnes nullables
-- sur minigame_sessions car spécifiques à ce game_type — même logique que entry_fee
-- (migration 013), validation côté app plutôt qu'un CHECK conditionné par game_type.
-- IF NOT EXISTS sur ends_at : une expérimentation antérieure non commitée avait déjà
-- ajouté cette colonne (et une session de test 'flappy_bird') directement en dev sans
-- jamais passer par une migration versionnée — cette clause rend le déploiement idempotent
-- sans avoir à toucher/nettoyer cet état orphelin.
ALTER TABLE minigame_sessions
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN reward_1st INT,
  ADD COLUMN reward_2nd INT,
  ADD COLUMN reward_3rd INT;

ALTER TABLE minigame_sessions
  ADD CONSTRAINT minigame_reward_1st_non_negative CHECK (reward_1st IS NULL OR reward_1st >= 0),
  ADD CONSTRAINT minigame_reward_2nd_non_negative CHECK (reward_2nd IS NULL OR reward_2nd >= 0),
  ADD CONSTRAINT minigame_reward_3rd_non_negative CHECK (reward_3rd IS NULL OR reward_3rd >= 0);

-- Historique brut de chaque partie jouée (traçabilité/audit — même principe que
-- gambling_opens). Pas d'unicité : un joueur peut rejouer tant que la session est
-- 'open' et que ends_at n'est pas dépassé.
CREATE TABLE flappybird_attempts (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES minigame_sessions(id),
  user_id INT REFERENCES users(id),
  score INT NOT NULL CHECK (score >= 0),
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Le MSP peut exclure une tentative suspecte avant la clôture (pas d'anti-triche
  -- auto en v1). On ne supprime jamais la ligne — même principe que la révocation
  -- de sp_transactions (migration 007) : marquer, jamais effacer.
  excluded_at TIMESTAMPTZ,
  excluded_by INT REFERENCES users(id)
);

CREATE INDEX idx_flappybird_attempts_session ON flappybird_attempts(session_id);
CREATE INDEX idx_flappybird_attempts_session_user ON flappybird_attempts(session_id, user_id);
