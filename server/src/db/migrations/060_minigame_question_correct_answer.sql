-- Réponse correcte optionnelle par question de quiz : le MSP peut la saisir
-- en posant la question, pour affichage automatique à la révélation des
-- réponses (même timing que le texte des réponses des joueurs — voir
-- minigames.controller.ts#buildQuestionView) plutôt que de devoir l'annoncer
-- à l'oral.
ALTER TABLE minigame_questions
  ADD COLUMN correct_answer TEXT;
