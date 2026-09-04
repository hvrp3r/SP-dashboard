-- Interrupteur MSP pour l'alerte Discord au lancement d'un mini-jeu. L'URL du
-- webhook elle-même vit dans DISCORD_WEBHOOK_URL (server/.env), pas ici : un
-- webhook Discord est un secret (quiconque le possède peut poster dans le
-- salon), il n'a donc pas sa place dans admin_config qui est exposé/éditable
-- en clair depuis le panel MSP. Désactivé par défaut, même logique que
-- blackjack_enabled (018) : une intégration tout juste ajoutée ne doit pas
-- se déclencher tant que le MSP ne l'a pas explicitement activée.
INSERT INTO admin_config (key, value, description) VALUES
  ('discord_notifications_enabled', 'false', 'Envoie une alerte Discord (webhook) au lancement d''un mini-jeu')
ON CONFLICT (key) DO NOTHING;
