-- Le rapprochement automatique avec `minigame_questions.correct_answer`
-- (comparaison texte insensible à la casse) n'est qu'une première vérification
-- indicative : le MSP reste seul juge final et peut désigner explicitement
-- qui a bon ou tort, réponse par réponse (utile en cas de faute de frappe, de
-- formulation différente mais correcte, etc.). NULL = pas encore tranché par
-- le MSP, on retombe alors sur le rapprochement automatique côté affichage.
ALTER TABLE minigame_answers
  ADD COLUMN marked_correct BOOLEAN;
