-- Couleurs de pseudo/titre animées (demande explicite de l'utilisateur : "des
-- couleurs animées comme une couleur arc-en-ciel etc"). Reste une simple
-- variante de color_value plutôt qu'un nouveau slot : un `name_color`/`title`
-- garde son color_value (base pour le repli non-animé et pour l'effet
-- "pulse"), color_animation est juste un effet visuel appliqué par-dessus
-- côté client (filter: hue-rotate/brightness — voir client/src/index.css),
-- jamais calculé côté serveur.
ALTER TABLE cosmetics ADD COLUMN color_animation VARCHAR(20);
ALTER TABLE cosmetics ADD CONSTRAINT cosmetic_color_animation_valid
  CHECK (color_animation IS NULL OR color_animation IN ('rainbow', 'pulse'));

INSERT INTO cosmetics (slot, key, name, description, color_value, color_animation, rarity) VALUES
  ('name_color', 'color_arcenciel', 'Arc-en-ciel', 'Une couleur de pseudo qui parcourt tout le spectre.', '#f87171', 'rainbow', 'legendary'),
  ('name_color', 'color_pulse_violet', 'Pulsation Violette', 'Un pseudo qui pulse doucement.', '#c084fc', 'pulse', 'epic')
ON CONFLICT (key) DO NOTHING;
