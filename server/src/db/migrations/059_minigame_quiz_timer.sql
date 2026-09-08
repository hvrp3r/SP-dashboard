-- Timer optionnel par question de quiz : le MSP peut fixer une durée de
-- réponse en secondes. La question se clôture alors automatiquement à
-- l'expiration, selon le même principe de "check à la lecture" que
-- l'expiration des défis (challenge.service.ts#expirePendingChallenges) —
-- pas de cron, le serveur clôture au prochain accès à la session.
ALTER TABLE minigame_questions
  ADD COLUMN duration_seconds INT,
  ADD COLUMN ends_at TIMESTAMPTZ,
  ADD CONSTRAINT minigame_question_duration_positive CHECK (duration_seconds IS NULL OR duration_seconds > 0);
