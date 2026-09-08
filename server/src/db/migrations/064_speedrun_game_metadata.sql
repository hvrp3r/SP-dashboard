-- Permet au MSP de rattacher une session Speedrun à une fiche jeu speedrun.com
-- (recherche côté serveur, voir speedruncom.service.ts) : image de couverture +
-- lien de redirection vers la page du jeu. Colonnes nullables et génériques sur
-- minigame_sessions (pas de FK ni de CHECK sur game_type) — même logique que
-- ends_at/reward_1st/2nd/3rd (migration 034) : validation côté app, réutilisables
-- par un futur game_type si besoin. Purement optionnel : le MSP garde la main pour
-- saisir titre/description à la main sans jamais passer par la recherche.
ALTER TABLE minigame_sessions
  ADD COLUMN game_image_url TEXT,
  ADD COLUMN game_external_url TEXT;
