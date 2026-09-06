-- Deux changements de fond demandés par l'utilisateur après la 1re version du
-- Sudoku (045_sudoku.sql) :
--   1. Le joueur doit choisir une difficulté avant de découvrir la moindre
--      grille (fini le changement libre d'onglet Facile/Moyen/Difficile) —
--      un choix par joueur par jour, définitif pour la journée.
--   2. Un nombre max de soumissions par jour (`sudoku_max_attempts`, défaut
--      5, configurable MSP) — même principe que motus_max_attempts. Chaque
--      appel à /check consomme une tentative, correcte ou non.
--
-- `sudoku_completions` n'a plus lieu d'être : le statut "gagné" se déduit
-- maintenant de l'historique des tentatives (`is_correct`), exactement comme
-- Motus le fait avec motus_attempts — perdre cette table ne perd aucun
-- historique économique (les sp_transactions restent la source de vérité).

CREATE TABLE sudoku_player_choices (
  id SERIAL PRIMARY KEY,
  puzzle_date DATE NOT NULL,
  user_id INT NOT NULL REFERENCES users(id),
  difficulty VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  chosen_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (puzzle_date, user_id)
);

-- Une tentative = une soumission de grille (complète ou non), verrouillée une
-- fois enregistrée — même principe que motus_attempts.
CREATE TABLE sudoku_attempts (
  id SERIAL PRIMARY KEY,
  puzzle_id INT NOT NULL REFERENCES sudoku_daily_puzzles(id),
  user_id INT NOT NULL REFERENCES users(id),
  attempt_number INT NOT NULL CHECK (attempt_number > 0),
  guess VARCHAR(81) NOT NULL CHECK (guess ~ '^[0-9]{81}$'),
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (puzzle_id, user_id, attempt_number)
);

CREATE INDEX idx_sudoku_attempts_puzzle_user ON sudoku_attempts(puzzle_id, user_id);

DROP TABLE sudoku_completions;

INSERT INTO admin_config (key, value, description) VALUES
  ('sudoku_max_attempts', '5', 'Nombre max de soumissions par joueur par jour au Sudoku')
ON CONFLICT (key) DO NOTHING;
