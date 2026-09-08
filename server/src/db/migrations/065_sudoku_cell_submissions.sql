-- Refacto du Sudoku demandé par l'utilisateur : passage d'une soumission
-- "grille entière" (bouton Vérifier consommant une tentative complète) à une
-- validation immédiate case par case, comme les sites de sudoku classiques.
-- Chaque chiffre saisi est désormais soumis au serveur dès qu'il est tapé :
-- juste, la case se verrouille (comme un indice, décision explicite de
-- l'utilisateur) ; faux, elle reste éditable mais compte comme une erreur.
--
-- `sudoku_attempts` stockait une grille complète par ligne (`guess`, 81
-- caractères) ; elle stocke maintenant une case individuelle (`cell_index` +
-- `digit`). Les anciennes lignes ne sont plus interprétables sous ce nouveau
-- format — et une partie de Sudoku ne dure qu'une journée (réinitialisée à
-- minuit) — donc on les purge plutôt que de tenter une conversion sans
-- valeur.
TRUNCATE TABLE sudoku_attempts;

ALTER TABLE sudoku_attempts DROP COLUMN guess;
ALTER TABLE sudoku_attempts ADD COLUMN cell_index SMALLINT NOT NULL CHECK (cell_index >= 0 AND cell_index <= 80);
ALTER TABLE sudoku_attempts ADD COLUMN digit CHAR(1) NOT NULL CHECK (digit ~ '^[1-9]$');

-- Accélère la vérification "cette case est-elle déjà verrouillée ?" et le
-- calcul du nombre de cases résolues (une par utilisateur/puzzle/case au
-- plus, une case verrouillée ne peut plus être resoumise).
CREATE INDEX idx_sudoku_attempts_puzzle_user_correct
  ON sudoku_attempts(puzzle_id, user_id, cell_index)
  WHERE is_correct = true;

-- `sudoku_max_attempts_easy/medium/hard` devient une limite d'ERREURS
-- (décision explicite de l'utilisateur, même principe que les sites de
-- sudoku réels : N cases fausses = partie perdue) plutôt qu'un nombre de
-- vérifications de grille complète — même clé et même valeur par défaut,
-- seule la description change pour refléter le nouveau sens.
UPDATE admin_config SET description = 'Nombre max d''erreurs autorisées par jour au Sudoku (facile) avant de perdre la partie' WHERE key = 'sudoku_max_attempts_easy';
UPDATE admin_config SET description = 'Nombre max d''erreurs autorisées par jour au Sudoku (moyen) avant de perdre la partie' WHERE key = 'sudoku_max_attempts_medium';
UPDATE admin_config SET description = 'Nombre max d''erreurs autorisées par jour au Sudoku (difficile) avant de perdre la partie' WHERE key = 'sudoku_max_attempts_hard';

-- `sudoku_hide_feedback_*` n'a plus de sens dans ce modèle : chaque
-- soumission ne porte plus que sur une seule case, dont la justesse doit
-- être révélée immédiatement pour décider si elle se verrouille — il n'y a
-- plus de détail "case par case sur la grille entière" à cacher.
DELETE FROM admin_config WHERE key IN ('sudoku_hide_feedback_easy', 'sudoku_hide_feedback_medium', 'sudoku_hide_feedback_hard');
