-- Sudoku quotidien, à côté du Motus : contrairement au Motus, aucune file MSP
-- à consommer — les 3 grilles du jour (facile/moyen/difficile) sont générées
-- intégralement côté serveur (server/src/utils/sudoku.ts, backtracking +
-- vérification d'unicité de la solution), à la demande explicite de
-- l'utilisateur ("le MSP n'a pas à en créer"). Même idiome de création
-- paresseuse par date locale Europe/Paris que motus_daily_words /
-- subscriptions : le puzzle du jour est créé à la première requête de la
-- journée pour cette difficulté, pas par cron.

-- Une grille par (date locale, difficulté) — trois lignes créées par jour au
-- fil des consultations, jamais générées à l'avance. Stockées en chaîne de 81
-- chiffres (lecture ligne par ligne) plutôt qu'en tableau, même simplicité
-- que motus_daily_words.word (VARCHAR) : pas de JSONB nécessaire pour une
-- grille de taille fixe.
CREATE TABLE sudoku_daily_puzzles (
  id SERIAL PRIMARY KEY,
  puzzle_date DATE NOT NULL,
  difficulty VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  givens VARCHAR(81) NOT NULL CHECK (givens ~ '^[0-9]{81}$'),   -- '0' = case vide à remplir
  solution VARCHAR(81) NOT NULL CHECK (solution ~ '^[1-9]{81}$'),
  season_id INT REFERENCES seasons(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (puzzle_date, difficulty)
);

-- Une résolution par joueur par grille (verrouille la récompense à une seule
-- fois, `UNIQUE(puzzle_id, user_id)` fait foi) — pas de table d'essais
-- intermédiaires façon motus_attempts : un Sudoku est un puzzle logique, pas
-- une devinette à tentatives limitées, donc pas d'historique de vérification
-- à conserver, seulement l'état final "résolu".
CREATE TABLE sudoku_completions (
  id SERIAL PRIMARY KEY,
  puzzle_id INT NOT NULL REFERENCES sudoku_daily_puzzles(id),
  user_id INT NOT NULL REFERENCES users(id),
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (puzzle_id, user_id)
);

CREATE INDEX idx_sudoku_completions_puzzle ON sudoku_completions(puzzle_id);

INSERT INTO admin_config (key, value, description) VALUES
  ('sudoku_reward_easy', '5', 'SP gagnés en résolvant le Sudoku du jour (facile)'),
  ('sudoku_reward_medium', '10', 'SP gagnés en résolvant le Sudoku du jour (moyen)'),
  ('sudoku_reward_hard', '15', 'SP gagnés en résolvant le Sudoku du jour (difficile)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (
  type IN (
    'login_bonus', 'challenge_win', 'challenge_loss', 'minigame_reward', 'minigame_entry',
    'admin_grant', 'admin_deduct', 'gambling_spend', 'gambling_win',
    'auction_bid_hold', 'auction_bid_refund', 'auction_sale',
    'motus_reward', 'sudoku_reward'
  )
);
