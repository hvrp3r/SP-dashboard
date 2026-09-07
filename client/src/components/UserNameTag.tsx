import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { colorAnimationClass } from '../lib/cosmeticsLabels.js';
import { extractFontName, loadGoogleFont } from '../lib/googleFonts.js';
import type { EquippedCosmetic } from '../types.js';

interface UserNameTagProps {
  username: string;
  equipped?: EquippedCosmetic[];
  className?: string;
  /** false pour désactiver le lien vers le profil (ex : texte d'un `<select>`, contrôle déjà interactif). Par défaut cliquable. */
  linkable?: boolean;
}

/** Pseudo affiché avec la couleur, la police et le titre cosmétiques équipés
 * (Leaderboard, Profil…), et cliquable vers le profil public du joueur —
 * `/profil` (le sien) quand l'appelant a substitué le pseudo par "Toi", sinon
 * `/joueurs/:username`. */
export default function UserNameTag({
  username,
  equipped = [],
  className = '',
  linkable = true,
}: UserNameTagProps) {
  const nameColor = equipped.find((c) => c.slot === 'name_color');
  const color = nameColor?.color_value;
  const font = equipped.find((c) => c.slot === 'name_font')?.font_family;
  const title = equipped.find((c) => c.slot === 'title' && c.key !== 'title_none');

  useEffect(() => {
    loadGoogleFont(extractFontName(font));
  }, [font]);

  const content = (
    <>
      <span
        className={`font-medium whitespace-nowrap ${linkable ? 'hover:underline' : ''} ${colorAnimationClass(nameColor?.color_animation)} ${className}`}
        style={{
          // .cosmetic-anim-shimmer met color: transparent (dégradé + background-clip:text,
          // voir index.css) — un inline `color` gagnerait toujours sur cette règle de classe,
          // donc on ne le pose pas dans ce cas, seulement --cosmetic-color pour le dégradé.
          ...(color
            ? nameColor?.color_animation === 'shimmer'
              ? ({ '--cosmetic-color': color } as CSSProperties)
              : { color }
            : {}),
          // --cosmetic-color-2 : accent de glitch/lightning/shimmer (voir index.css) — ignoré
          // par les autres animations, donc rien à conditionner ici.
          ...(nameColor?.color_secondary
            ? ({ '--cosmetic-color-2': nameColor.color_secondary } as CSSProperties)
            : {}),
          ...(font ? { fontFamily: font } : {}),
        }}
      >
        {username}
      </span>
      {title &&
        (title.color_value ? (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${colorAnimationClass(title.color_animation)}`}
            style={{
              borderColor: `${title.color_value}66`,
              backgroundColor: `${title.color_value}1a`,
              color: title.color_value,
              ...(title.color_secondary
                ? ({ '--cosmetic-color-2': title.color_secondary } as CSSProperties)
                : {}),
            }}
          >
            {title.name}
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-semibold whitespace-nowrap">
            {title.name}
          </span>
        ))}
    </>
  );

  if (!linkable) {
    return <span className="inline-flex items-center gap-1.5 min-w-0">{content}</span>;
  }

  const href = username === 'Toi' ? '/profil' : `/joueurs/${encodeURIComponent(username)}`;
  return (
    <Link to={href} className="inline-flex items-center gap-1.5 min-w-0">
      {content}
    </Link>
  );
}
