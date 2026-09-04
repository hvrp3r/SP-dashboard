-- Nouvel emplacement 'name_font' : police de pseudo (liste fermée de Google
-- Fonts chargées globalement, voir client/index.html). Réutilise le pattern
-- déjà en place pour name_color/color_value, mais une police est une chaîne
-- CSS font-family, pas une couleur — nouvelle colonne dédiée plutôt que de
-- surcharger color_value (confusion sémantique).
ALTER TABLE cosmetics ADD COLUMN font_family TEXT;
ALTER TABLE cosmetics DROP CONSTRAINT cosmetic_slot_valid;
ALTER TABLE cosmetics ADD CONSTRAINT cosmetic_slot_valid
  CHECK (slot IN ('avatar_frame', 'banner', 'name_color', 'title', 'name_font'));

INSERT INTO cosmetics (slot, key, name, description, is_default, rarity) VALUES
  ('name_font', 'font_default', 'Police par défaut', 'Police système standard.', true, 'common')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cosmetics (slot, key, name, font_family, rarity) VALUES
  ('name_font', 'font_bangers', 'Comic Punch', '"Bangers", cursive', 'rare'),
  ('name_font', 'font_pixel', 'Pixel Rétro', '"Press Start 2P", monospace', 'epic'),
  ('name_font', 'font_script', 'Signature', '"Pacifico", cursive', 'rare'),
  ('name_font', 'font_future', 'Cyber', '"Orbitron", sans-serif', 'epic'),
  ('name_font', 'font_marker', 'Marqueur', '"Permanent Marker", cursive', 'common')
ON CONFLICT (key) DO NOTHING;

-- Deux nouveaux cosmétiques animés (SMIL) pour montrer l'aspect "vivant"
INSERT INTO cosmetics (slot, key, name, description, image_url, rarity) VALUES
  ('avatar_frame', 'frame_arcenciel', 'Cadre Arc-en-ciel', 'Un anneau qui tourne sans arrêt.', '/cosmetics/frame_arcenciel.svg', 'legendary'),
  ('banner', 'banner_aurore', 'Aurore Boréale', 'Un fond qui ondule doucement.', '/cosmetics/banner_aurore.svg', 'legendary')
ON CONFLICT (key) DO NOTHING;
