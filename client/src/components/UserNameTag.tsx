import { useEffect } from 'react';
import { extractFontName, loadGoogleFont } from '../lib/googleFonts.js';
import type { EquippedCosmetic } from '../types.js';

interface UserNameTagProps {
  username: string;
  equipped?: EquippedCosmetic[];
  className?: string;
}

/** Pseudo affiché avec la couleur, la police et le titre cosmétiques équipés (Leaderboard, Profil…). */
export default function UserNameTag({ username, equipped = [], className = '' }: UserNameTagProps) {
  const color = equipped.find((c) => c.slot === 'name_color')?.color_value;
  const font = equipped.find((c) => c.slot === 'name_font')?.font_family;
  const title = equipped.find((c) => c.slot === 'title' && c.key !== 'title_none');

  useEffect(() => {
    loadGoogleFont(extractFontName(font));
  }, [font]);

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className={`font-medium whitespace-nowrap ${className}`}
        style={{ ...(color ? { color } : {}), ...(font ? { fontFamily: font } : {}) }}
      >
        {username}
      </span>
      {title &&
        (title.color_value ? (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap"
            style={{
              borderColor: `${title.color_value}66`,
              backgroundColor: `${title.color_value}1a`,
              color: title.color_value,
            }}
          >
            {title.name}
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-semibold whitespace-nowrap">
            {title.name}
          </span>
        ))}
    </span>
  );
}
