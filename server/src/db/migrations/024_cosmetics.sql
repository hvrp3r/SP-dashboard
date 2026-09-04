-- Cosmétiques équipables (cadres d'avatar, bannières de profil, couleurs de
-- pseudo, titres) : purement visuels, distincts des gains 'custom' du
-- gambling qui restent des trophées de collection non-équipables dans
-- gambling_inventory (voir CLAUDE.md section 7). Un joueur ne "possède" pas
-- forcément le cosmétique is_default de chaque emplacement : il sert de
-- repli implicite quand rien n'est équipé, pour éviter d'avoir à insérer une
-- ligne user_cosmetics pour chaque joueur existant à chaque nouveau défaut.
-- Distribution pour cette première passe : caisses gambling (nouveau type de
-- récompense 'cosmetic', réutilise le tirage pondéré existant) + octroi
-- manuel MSP. Streak/saison/Ko-fi restent pour une itération future.

CREATE TABLE cosmetics (
  id SERIAL PRIMARY KEY,
  slot VARCHAR(20) NOT NULL,
  key VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT,           -- cadre/bannière ; NULL pour name_color et title
  color_value VARCHAR(20),  -- hex, utilisé par name_color
  rarity VARCHAR(20) NOT NULL DEFAULT 'common',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT cosmetic_slot_valid CHECK (slot IN ('avatar_frame', 'banner', 'name_color', 'title')),
  CONSTRAINT cosmetic_rarity_valid CHECK (rarity IN ('common', 'rare', 'epic', 'legendary'))
);
-- Un seul défaut par emplacement (le fallback quand rien n'est équipé)
CREATE UNIQUE INDEX cosmetics_one_default_per_slot ON cosmetics(slot) WHERE is_default = true;

CREATE TABLE user_cosmetics (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  cosmetic_id INT NOT NULL REFERENCES cosmetics(id),
  slot VARCHAR(20) NOT NULL,  -- dénormalisé depuis cosmetics.slot, pour l'index d'unicité ci-dessous
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  obtained_source VARCHAR(30) NOT NULL,  -- 'gambling' | 'admin_grant'
  obtained_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, cosmetic_id)
);
-- Un seul cosmétique équipé par emplacement et par joueur
CREATE UNIQUE INDEX user_cosmetics_one_equipped_per_slot ON user_cosmetics(user_id, slot) WHERE equipped = true;
CREATE INDEX idx_user_cosmetics_user ON user_cosmetics(user_id);

-- Nouveau type de récompense caisse : tire un cosmétique du catalogue au lieu de SP
ALTER TABLE gambling_crate_rewards ADD COLUMN cosmetic_id INT REFERENCES cosmetics(id);
ALTER TABLE gambling_crate_rewards DROP CONSTRAINT gambling_reward_type_valid;
ALTER TABLE gambling_crate_rewards ADD CONSTRAINT gambling_reward_type_valid
  CHECK (type IN ('sp', 'custom', 'cosmetic'));
ALTER TABLE gambling_crate_rewards DROP CONSTRAINT gambling_reward_sp_amount_consistent;
ALTER TABLE gambling_crate_rewards ADD CONSTRAINT gambling_reward_sp_amount_consistent CHECK (
  (type = 'sp' AND sp_amount IS NOT NULL AND sp_amount > 0 AND cosmetic_id IS NULL) OR
  (type = 'custom' AND sp_amount IS NULL AND cosmetic_id IS NULL) OR
  (type = 'cosmetic' AND sp_amount IS NULL AND cosmetic_id IS NOT NULL)
);

ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (type IN (
  'challenge_received', 'challenge_accepted', 'challenge_declined',
  'challenge_resolved', 'challenge_cancelled', 'challenge_expired',
  'minigame_open', 'sp_gained', 'sp_lost', 'cosmetic_earned'
));

-- Défauts (fallback par emplacement, jamais supprimables)
INSERT INTO cosmetics (slot, key, name, description, is_default, rarity) VALUES
  ('avatar_frame', 'frame_none', 'Aucun cadre', 'Pas de cadre autour de l''avatar.', true, 'common'),
  ('banner', 'banner_none', 'Bannière par défaut', 'Fond de profil standard.', true, 'common'),
  ('name_color', 'color_default', 'Blanc', 'Couleur de pseudo par défaut.', true, 'common'),
  ('title', 'title_none', 'Aucun titre', 'Pas de titre affiché.', true, 'common')
ON CONFLICT (key) DO NOTHING;
UPDATE cosmetics SET color_value = '#e4e4e7' WHERE key = 'color_default';

-- Catalogue de départ (obtenables via caisses gambling ou octroi MSP)
INSERT INTO cosmetics (slot, key, name, description, image_url, rarity) VALUES
  ('avatar_frame', 'frame_bronze', 'Cadre Bronze', 'Un cadre discret pour bien commencer.', NULL, 'common'),
  ('avatar_frame', 'frame_argent', 'Cadre Argent', 'Un cadre qui brille un peu plus.', NULL, 'rare'),
  ('avatar_frame', 'frame_or', 'Cadre Or', 'Réservé aux joueurs qui en veulent.', NULL, 'epic'),
  ('avatar_frame', 'frame_feu', 'Cadre Enflammé', 'Pour les habitués du risque.', NULL, 'legendary'),
  ('banner', 'banner_nuit', 'Nuit Étoilée', 'Un fond sombre et étoilé.', NULL, 'rare'),
  ('banner', 'banner_sourire', 'Dégradé Sourire', 'Les couleurs de Points Sourires.', NULL, 'epic'),
  ('title', 'title_recrue', 'Recrue', NULL, NULL, 'common'),
  ('title', 'title_veteran', 'Vétéran', NULL, NULL, 'rare'),
  ('title', 'title_chanceux', 'Chanceux', NULL, NULL, 'epic'),
  ('title', 'title_legende', 'Légende', NULL, NULL, 'legendary')
ON CONFLICT (key) DO NOTHING;
INSERT INTO cosmetics (slot, key, name, color_value, rarity) VALUES
  ('name_color', 'color_rouge', 'Rouge', '#f87171', 'common'),
  ('name_color', 'color_bleu', 'Bleu', '#60a5fa', 'common'),
  ('name_color', 'color_vert', 'Vert', '#4ade80', 'rare'),
  ('name_color', 'color_violet', 'Violet', '#c084fc', 'epic'),
  ('name_color', 'color_or', 'Or', '#facc15', 'legendary')
ON CONFLICT (key) DO NOTHING;
