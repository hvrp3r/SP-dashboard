-- Assets par défaut pour le catalogue de cosmétiques (migration 024) : les
-- cadres/bannières de départ avaient un image_url NULL par design (le MSP
-- devait coller une URL lui-même), mais aucun visuel n'était fourni. Ajout
-- de SVG faits maison, servis statiquement depuis client/public/cosmetics/
-- (même origine que le client, pas besoin de passer par l'API) plutôt que
-- de dépendre d'un hébergeur externe.
UPDATE cosmetics SET image_url = '/cosmetics/frame_bronze.svg' WHERE key = 'frame_bronze';
UPDATE cosmetics SET image_url = '/cosmetics/frame_argent.svg' WHERE key = 'frame_argent';
UPDATE cosmetics SET image_url = '/cosmetics/frame_or.svg' WHERE key = 'frame_or';
UPDATE cosmetics SET image_url = '/cosmetics/frame_feu.svg' WHERE key = 'frame_feu';
UPDATE cosmetics SET image_url = '/cosmetics/banner_nuit.svg' WHERE key = 'banner_nuit';
UPDATE cosmetics SET image_url = '/cosmetics/banner_sourire.svg' WHERE key = 'banner_sourire';
