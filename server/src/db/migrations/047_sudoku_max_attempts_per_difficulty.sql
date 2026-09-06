-- Le nombre max de tentatives devient configurable par difficulté (au lieu
-- d'une seule valeur partagée) — même raisonnement que les récompenses déjà
-- différenciées par difficulté (sudoku_reward_easy/medium/hard).
DELETE FROM admin_config WHERE key = 'sudoku_max_attempts';

INSERT INTO admin_config (key, value, description) VALUES
  ('sudoku_max_attempts_easy', '5', 'Nombre max de soumissions par jour au Sudoku (facile)'),
  ('sudoku_max_attempts_medium', '5', 'Nombre max de soumissions par jour au Sudoku (moyen)'),
  ('sudoku_max_attempts_hard', '5', 'Nombre max de soumissions par jour au Sudoku (difficile)')
ON CONFLICT (key) DO NOTHING;
