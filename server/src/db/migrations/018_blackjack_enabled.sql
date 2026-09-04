-- Interrupteur propre au blackjack, indépendant de `gambling_enabled` (qui ne
-- gouverne plus que les caisses). Désactivé par défaut : un jeu tout juste
-- ajouté ne doit pas devenir visible/jouable pour tout le monde tant que le
-- MSP ne l'a pas explicitement activé dans /admin/config.
INSERT INTO admin_config (key, value, description) VALUES
  ('blackjack_enabled', 'false', 'Active/désactive le blackjack (indépendant des caisses)')
ON CONFLICT (key) DO NOTHING;

UPDATE admin_config SET description = 'Active/désactive les caisses (indépendant du blackjack)'
WHERE key = 'gambling_enabled';
