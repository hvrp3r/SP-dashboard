-- Permet au MSP de cacher le détail case par case (quelles cases sont
-- justes/fausses) pour une difficulté donnée — seul le nombre de cases
-- fausses est alors renvoyé au joueur après une soumission, à la place du
-- détail complet. Même granularité par difficulté que les récompenses et le
-- nombre de tentatives (sudoku_reward_*/sudoku_max_attempts_*).
INSERT INTO admin_config (key, value, description) VALUES
  ('sudoku_hide_feedback_easy', 'false', 'Cache le détail case par case au Sudoku (facile) — donne juste le nombre de cases fausses'),
  ('sudoku_hide_feedback_medium', 'false', 'Cache le détail case par case au Sudoku (moyen) — donne juste le nombre de cases fausses'),
  ('sudoku_hide_feedback_hard', 'false', 'Cache le détail case par case au Sudoku (difficile) — donne juste le nombre de cases fausses')
ON CONFLICT (key) DO NOTHING;
