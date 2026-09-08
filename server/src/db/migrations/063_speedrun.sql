-- Ajoute le support du mini-jeu "Speedrun" : le MSP choisit un jeu (hors-plateforme,
-- pas un jeu embarqué) et en configure les règles via title/description (déjà
-- génériques sur minigame_sessions), une deadline et des gains 1er/2e/3e — ends_at
-- et reward_1st/2nd/3rd sont déjà des colonnes nullables génériques depuis Flappy
-- Bird (migration 034), donc aucune colonne supplémentaire n'est nécessaire sur
-- minigame_sessions ici.
--
-- Contrairement à Flappy Bird (jeu embarqué, score capturé point par point côté
-- serveur), le jeu se joue hors-plateforme : chaque run est déclaré manuellement
-- par le joueur (temps chronométré + lien vidéo externe comme preuve), à charge
-- pour le MSP de vérifier la vidéo à l'œil et d'exclure une tentative frauduleuse —
-- même principe que flappybird_attempts.excluded_at (jamais de suppression).
CREATE TABLE speedrun_attempts (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES minigame_sessions(id),
  user_id INT REFERENCES users(id),
  time_ms INT NOT NULL CHECK (time_ms > 0),
  video_url TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluded_at TIMESTAMPTZ,
  excluded_by INT REFERENCES users(id)
);

CREATE INDEX idx_speedrun_attempts_session ON speedrun_attempts(session_id);
CREATE INDEX idx_speedrun_attempts_session_user ON speedrun_attempts(session_id, user_id);
