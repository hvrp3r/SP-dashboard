-- Deux besoins MSP supplémentaires sur le Motus :
--   1. Réordonner la file de mots configurés (position explicite, plutôt que
--      l'ordre d'ajout figé) — voir motusService.reorderQueueWord.
--   2. Modifier le mot du jour déjà tiré (avant que quiconque n'y ait tenté
--      une réponse) — voir motusService.overrideTodayWord. Un `source` explicite
--      remplace la déduction implicite "queue_id NULL => aléatoire" utilisée
--      jusqu'ici, pour distinguer proprement un mot remplacé à la main d'un
--      tirage aléatoire du dictionnaire.

ALTER TABLE motus_word_queue ADD COLUMN position INT NOT NULL DEFAULT 0;

-- Backfill : ordre actuel = ordre d'ajout, pour ne rien changer avant la
-- première réorganisation MSP.
UPDATE motus_word_queue AS q
SET position = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM motus_word_queue
) AS sub
WHERE q.id = sub.id;

CREATE INDEX idx_motus_word_queue_position ON motus_word_queue(position) WHERE used_at IS NULL;

ALTER TABLE motus_daily_words
  ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'random'
  CHECK (source IN ('queue', 'random', 'manual'));

UPDATE motus_daily_words SET source = CASE WHEN queue_id IS NOT NULL THEN 'queue' ELSE 'random' END;
