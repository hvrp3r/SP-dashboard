-- Nouveau palier de rareté "Peu commun" (uncommon), entre Commun et Rare —
-- décision explicite de l'utilisateur, couleur verte côté client
-- (client/src/lib/cosmeticsLabels.ts). Pas de reclassement des cosmétiques
-- déjà en base : c'est au MSP de choisir quand l'utiliser.
ALTER TABLE cosmetics DROP CONSTRAINT cosmetic_rarity_valid;
ALTER TABLE cosmetics ADD CONSTRAINT cosmetic_rarity_valid
  CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary'));

ALTER TABLE gambling_crate_rewards DROP CONSTRAINT gambling_reward_cosmetic_rarity_filter_valid;
ALTER TABLE gambling_crate_rewards ADD CONSTRAINT gambling_reward_cosmetic_rarity_filter_valid
  CHECK (cosmetic_rarity_filter IS NULL OR cosmetic_rarity_filter IN ('common', 'uncommon', 'rare', 'epic', 'legendary'));

INSERT INTO admin_config (key, value, description) VALUES
  ('cosmetic_rarity_weight_uncommon', '65', 'Poids de tirage relatif pour un cosmétique Peu Commun dans une récompense "pool" de caisse gambling')
ON CONFLICT (key) DO NOTHING;
