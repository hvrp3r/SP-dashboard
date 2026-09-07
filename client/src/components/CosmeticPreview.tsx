import type { CSSProperties } from 'react';
import { colorAnimationClass } from '../lib/cosmeticsLabels.js';
import type { Cosmetic } from '../types.js';

/** Aperçu visuel d'un cosmétique selon son emplacement — réutilisé par la page joueur et le panel MSP. */
export default function CosmeticPreview({ cosmetic, size = 56 }: { cosmetic: Cosmetic; size?: number }) {
  if (cosmetic.slot === 'name_color') {
    // 'shimmer' est un dégradé + background-clip:text (voir index.css) : sans texte à
    // découper, cette pastille vide deviendrait invisible. On affiche juste sa couleur
    // de base ici — l'effet reste bien visible partout où le pseudo s'affiche réellement.
    const animationClass =
      cosmetic.color_animation === 'shimmer' ? '' : colorAnimationClass(cosmetic.color_animation);
    return (
      <div
        style={
          {
            width: size,
            height: size,
            backgroundColor: cosmetic.color_value ?? '#3f3f46',
            ...(cosmetic.color_secondary ? { '--cosmetic-color-2': cosmetic.color_secondary } : {}),
          } as CSSProperties
        }
        className={`rounded-lg flex-shrink-0 border border-zinc-700 ${animationClass}`}
      />
    );
  }
  if (cosmetic.slot === 'title') {
    return (
      <div
        style={
          {
            width: size,
            height: size,
            borderColor: cosmetic.color_value ? `${cosmetic.color_value}66` : undefined,
            backgroundColor: cosmetic.color_value ? `${cosmetic.color_value}1a` : undefined,
            ...(cosmetic.color_secondary ? { '--cosmetic-color-2': cosmetic.color_secondary } : {}),
          } as CSSProperties
        }
        className={`rounded-lg bg-zinc-800 border border-transparent flex items-center justify-center flex-shrink-0 text-lg ${colorAnimationClass(cosmetic.color_animation)}`}
      >
        🏷️
      </div>
    );
  }
  if (cosmetic.slot === 'name_font') {
    return (
      <div
        style={{ width: size, height: size, fontFamily: cosmetic.font_family ?? undefined }}
        className="rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-100"
      >
        Aa
      </div>
    );
  }
  if (cosmetic.image_url) {
    return (
      <img
        src={cosmetic.image_url}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-lg object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 text-lg"
    >
      {cosmetic.slot === 'avatar_frame' ? '⭕' : '🖼️'}
    </div>
  );
}
