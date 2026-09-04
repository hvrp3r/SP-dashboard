-- Récompenses "pool" pour les caisses gambling : au lieu de toujours pointer
-- vers un cosmétique précis, une récompense type='cosmetic' peut désormais
-- filtrer par catégorie et/ou rareté (ex: "n'importe quel Titre Épique",
-- "n'importe quel Cadre" toutes raretés, "n'importe quel cosmétique Épique"
-- toutes catégories). Le cosmétique concret est tiré au moment de
-- l'ouverture (voir cosmetics.service.ts#pickRandomCosmeticForPool), pondéré
-- par les poids de rareté ci-dessous plutôt qu'uniformément — un légendaire
-- doit rester plus rare qu'un commun même à l'intérieur d'un même pool.
ALTER TABLE gambling_crate_rewards ADD COLUMN cosmetic_slot_filter VARCHAR(20);
ALTER TABLE gambling_crate_rewards ADD COLUMN cosmetic_rarity_filter VARCHAR(20);
ALTER TABLE gambling_crate_rewards ADD CONSTRAINT gambling_reward_cosmetic_slot_filter_valid
  CHECK (cosmetic_slot_filter IS NULL OR cosmetic_slot_filter IN ('avatar_frame','banner','name_color','title','name_font'));
ALTER TABLE gambling_crate_rewards ADD CONSTRAINT gambling_reward_cosmetic_rarity_filter_valid
  CHECK (cosmetic_rarity_filter IS NULL OR cosmetic_rarity_filter IN ('common','rare','epic','legendary'));

-- Une récompense 'cosmetic' est soit précise (cosmetic_id, comportement
-- historique), soit un pool (pas de cosmetic_id, au moins un filtre) — jamais
-- les deux, jamais ni l'un ni l'autre.
ALTER TABLE gambling_crate_rewards DROP CONSTRAINT gambling_reward_sp_amount_consistent;
ALTER TABLE gambling_crate_rewards ADD CONSTRAINT gambling_reward_sp_amount_consistent CHECK (
  (type = 'sp' AND sp_amount IS NOT NULL AND sp_amount > 0
    AND cosmetic_id IS NULL AND cosmetic_slot_filter IS NULL AND cosmetic_rarity_filter IS NULL) OR
  (type = 'custom' AND sp_amount IS NULL
    AND cosmetic_id IS NULL AND cosmetic_slot_filter IS NULL AND cosmetic_rarity_filter IS NULL) OR
  (type = 'cosmetic' AND sp_amount IS NULL AND (
    (cosmetic_id IS NOT NULL AND cosmetic_slot_filter IS NULL AND cosmetic_rarity_filter IS NULL) OR
    (cosmetic_id IS NULL AND (cosmetic_slot_filter IS NOT NULL OR cosmetic_rarity_filter IS NOT NULL))
  ))
);

INSERT INTO admin_config (key, value, description) VALUES
  ('cosmetic_rarity_weight_common', '100', 'Poids de tirage relatif pour un cosmétique Commun dans une récompense "pool" (catégorie/rareté) de caisse gambling'),
  ('cosmetic_rarity_weight_rare', '35', 'Poids de tirage relatif pour un cosmétique Rare dans une récompense "pool" de caisse gambling'),
  ('cosmetic_rarity_weight_epic', '12', 'Poids de tirage relatif pour un cosmétique Épique dans une récompense "pool" de caisse gambling'),
  ('cosmetic_rarity_weight_legendary', '4', 'Poids de tirage relatif pour un cosmétique Légendaire dans une récompense "pool" de caisse gambling')
ON CONFLICT (key) DO NOTHING;
