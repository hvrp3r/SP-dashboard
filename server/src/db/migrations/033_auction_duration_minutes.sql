-- La durée d'une enchère était bornée en heures entières (auction_min/max_duration_hours),
-- trop grossier — l'utilisateur veut pouvoir démarrer une enchère avec un
-- timer personnalisé en minutes. Remplace les deux clés par leur équivalent
-- en minutes (mêmes bornes par défaut : 1h -> 60min, 72h -> 4320min).
DELETE FROM admin_config WHERE key IN ('auction_min_duration_hours', 'auction_max_duration_hours');

INSERT INTO admin_config (key, value, description) VALUES
  ('auction_min_duration_minutes', '5', 'Durée minimale (en minutes) d''une enchère de cosmétique'),
  ('auction_max_duration_minutes', '4320', 'Durée maximale (en minutes) d''une enchère de cosmétique')
ON CONFLICT (key) DO NOTHING;
