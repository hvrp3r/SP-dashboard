-- Les titres réutilisent color_value (déjà utilisé par name_color) pour se
-- teinter au lieu d'un vert fixe (voir UserNameTag.tsx) — le MSP peut aussi
-- configurer cette couleur depuis /cosmetiques. Couleurs de départ alignées
-- sur la rareté de chaque titre déjà semé (migration 025).
UPDATE cosmetics SET color_value = '#a1a1aa' WHERE key = 'title_recrue';    -- commun (zinc)
UPDATE cosmetics SET color_value = '#a78bfa' WHERE key = 'title_veteran';   -- rare (violet)
UPDATE cosmetics SET color_value = '#fbbf24' WHERE key = 'title_chanceux';  -- épique (amber)
UPDATE cosmetics SET color_value = '#34d399' WHERE key = 'title_legende';   -- légendaire (emerald)
