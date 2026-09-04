import type { Cosmetic } from '../types.js';

/** Aperçu visuel d'un cosmétique selon son emplacement — réutilisé par la page joueur et le panel MSP. */
export default function CosmeticPreview({ cosmetic, size = 56 }: { cosmetic: Cosmetic; size?: number }) {
  if (cosmetic.slot === 'name_color') {
    return (
      <div
        style={{ width: size, height: size, backgroundColor: cosmetic.color_value ?? '#3f3f46' }}
        className="rounded-lg flex-shrink-0 border border-zinc-700"
      />
    );
  }
  if (cosmetic.slot === 'title') {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderColor: cosmetic.color_value ? `${cosmetic.color_value}66` : undefined,
          backgroundColor: cosmetic.color_value ? `${cosmetic.color_value}1a` : undefined,
        }}
        className="rounded-lg bg-zinc-800 border border-transparent flex items-center justify-center flex-shrink-0 text-lg"
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
