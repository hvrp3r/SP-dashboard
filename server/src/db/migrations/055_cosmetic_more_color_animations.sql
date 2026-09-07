-- Étend le catalogue d'animations de couleur (migration 054) avec les
-- options discutées avec l'utilisateur : néon, feu, glace, disco, glitch,
-- éclair, chatoyant. Le "chatoyant" (shimmer) est un dégradé + background-clip
-- côté client (voir index.css) plutôt qu'un simple filter — pas viable sur le
-- badge de titre (casserait son fond teinté), donc restreint à name_color côté
-- UI (client/src/lib/cosmeticsLabels.ts), pas au niveau de cette contrainte
-- (même logique que color_value/font_family : pas de restriction par slot en
-- base, juste côté client).
ALTER TABLE cosmetics DROP CONSTRAINT cosmetic_color_animation_valid;
ALTER TABLE cosmetics ADD CONSTRAINT cosmetic_color_animation_valid
  CHECK (color_animation IS NULL OR color_animation IN (
    'rainbow', 'pulse', 'neon', 'fire', 'ice', 'disco', 'glitch', 'lightning', 'shimmer'
  ));
