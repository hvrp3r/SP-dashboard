-- Un cosmétique de couleur de pseudo par animation ajoutée en migration 055
-- (néon, feu, glace, disco, glitch, éclair, chatoyant) — même principe que
-- 'color_arcenciel'/'color_pulse_violet' semés en 054 : un exemple concret
-- par effet plutôt que de laisser le MSP les découvrir uniquement via le
-- formulaire de création.
INSERT INTO cosmetics (slot, key, name, description, color_value, color_animation, rarity) VALUES
  ('name_color', 'color_neon', 'Néon', 'Un pseudo qui brille façon enseigne.', '#22d3ee', 'neon', 'rare'),
  ('name_color', 'color_feu', 'Flamme', 'Un pseudo qui vacille comme une flamme.', '#f97316', 'fire', 'epic'),
  ('name_color', 'color_glace', 'Glaciale', 'Un pseudo au chatoiement froid.', '#38bdf8', 'ice', 'rare'),
  ('name_color', 'color_disco', 'Boule Disco', 'Des sauts de couleur façon piste de danse.', '#ec4899', 'disco', 'legendary'),
  ('name_color', 'color_glitch', 'Glitch', 'Un pseudo qui bug par intermittence.', '#84cc16', 'glitch', 'legendary'),
  ('name_color', 'color_eclair', 'Éclair', 'Un pseudo frappé par la foudre.', '#fde047', 'lightning', 'epic'),
  ('name_color', 'color_chatoyant', 'Chatoyant', 'Un reflet lumineux qui balaie le pseudo.', '#c4b5fd', 'shimmer', 'epic')
ON CONFLICT (key) DO NOTHING;
