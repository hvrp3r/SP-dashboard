-- Réalignement des couleurs de rareté (décision explicite de l'utilisateur) :
-- commun=gris (inchangé), rare=bleu, épique=violet, légendaire=jaune doré.
-- Met à jour les couleurs des titres déjà semés (migration 027) pour rester
-- cohérent avec le nouveau schéma appliqué côté client
-- (client/src/lib/cosmeticsLabels.ts).
UPDATE cosmetics SET color_value = '#60a5fa' WHERE key = 'title_veteran';   -- rare (bleu, ex-violet)
UPDATE cosmetics SET color_value = '#c084fc' WHERE key = 'title_chanceux';  -- épique (violet, ex-ambre)
UPDATE cosmetics SET color_value = '#fbbf24' WHERE key = 'title_legende';   -- légendaire (jaune doré, ex-émeraude)
