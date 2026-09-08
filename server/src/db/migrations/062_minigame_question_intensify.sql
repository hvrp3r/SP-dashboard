-- Le MSP peut déclencher manuellement la phase "intense" de la musique de
-- tension (bascule de la boucle part1 -> part2) avant même que le timer
-- n'atteigne le seuil automatique — utile pour rythmer le suspense à sa
-- convenance plutôt que de dépendre uniquement du décompte. Propagé à tous
-- les joueurs via le polling existant (chacun joue sa propre musique
-- localement, il n'y a pas de flux audio partagé).
ALTER TABLE minigame_questions
  ADD COLUMN intense_at TIMESTAMPTZ;
