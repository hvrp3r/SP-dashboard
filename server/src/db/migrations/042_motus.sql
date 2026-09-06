-- Motus : mot à deviner par jour (façon Wordle), un mot commun à tous les
-- joueurs par date locale Europe/Paris (même frontière de journée que le
-- bonus quotidien / budget gambling, voir localDate.ts) — pas de cron, le mot
-- du jour est créé paresseusement à la première requête de la journée
-- (même idiome que la ligne `subscriptions`, créée au premier accès).
--
-- Simplification assumée : mots en lettres A-Z uniquement (pas d'accents),
-- aussi bien dans la file MSP que dans le dictionnaire aléatoire embarqué
-- (motus.service.ts) — évite un clavier virtuel accentué côté client pour un
-- gain de fidélité marginal.

-- File de mots configurés par le MSP, consommée dans l'ordre d'ajout (FIFO).
-- Un mot déjà utilisé (`used_at` non NULL) reste en base pour l'historique
-- mais ne peut plus être reconsommé.
CREATE TABLE motus_word_queue (
  id SERIAL PRIMARY KEY,
  word VARCHAR(20) NOT NULL CHECK (word ~ '^[A-Z]{3,12}$'),
  added_by INT REFERENCES users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_motus_word_queue_pending ON motus_word_queue(created_at) WHERE used_at IS NULL;

-- Un mot par jour local, figé une fois créé (`UNIQUE(word_date)` garantit
-- qu'un seul mot existe pour une date donnée même si plusieurs joueurs
-- déclenchent sa création en même temps — voir getOrCreateDailyWord).
CREATE TABLE motus_daily_words (
  id SERIAL PRIMARY KEY,
  word_date DATE NOT NULL UNIQUE,
  word VARCHAR(20) NOT NULL CHECK (word ~ '^[A-Z]{3,12}$'),
  queue_id INT REFERENCES motus_word_queue(id),  -- NULL si généré aléatoirement (file vide ce jour-là)
  season_id INT REFERENCES seasons(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Une tentative par joueur par mot du jour, numérotée et verrouillée (jamais
-- modifiée après coup) — même principe que minigame_answers.
CREATE TABLE motus_attempts (
  id SERIAL PRIMARY KEY,
  daily_word_id INT NOT NULL REFERENCES motus_daily_words(id),
  user_id INT NOT NULL REFERENCES users(id),
  attempt_number INT NOT NULL CHECK (attempt_number > 0),
  guess VARCHAR(20) NOT NULL,
  result JSONB NOT NULL,        -- tableau par lettre : 'correct' | 'present' | 'absent'
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (daily_word_id, user_id, attempt_number)
);

CREATE INDEX idx_motus_attempts_word_user ON motus_attempts(daily_word_id, user_id);

INSERT INTO admin_config (key, value, description) VALUES
  ('motus_reward_sp', '5', 'SP gagnés en trouvant le mot du jour au Motus'),
  ('motus_max_attempts', '6', 'Nombre max de tentatives par joueur par jour au Motus')
ON CONFLICT (key) DO NOTHING;
