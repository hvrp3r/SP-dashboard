/**
 * Chargement de polices Google Fonts au runtime, sans déploiement — le MSP
 * saisit un nom de police (ex: "Fredoka") dans le panel Cosmétiques, et
 * l'app injecte le <link> Google Fonts correspondant à la volée. L'API
 * Google Fonts CSS2 est publique (pas de clé requise), il suffit de
 * construire l'URL avec le nom encodé.
 */

const loadedFonts = new Set<string>();

/** Injecte un <link> Google Fonts pour ce nom de police s'il n'est pas déjà chargé. */
export function loadGoogleFont(name: string | null | undefined): void {
  const trimmed = name?.trim();
  if (!trimmed || loadedFonts.has(trimmed)) return;
  loadedFonts.add(trimmed);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(trimmed).replace(/%20/g, '+')}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

/** Extrait le nom brut d'une valeur CSS font-family stockée (ex: '"Fredoka", sans-serif' → 'Fredoka'). */
export function extractFontName(fontFamily: string | null | undefined): string | null {
  if (!fontFamily) return null;
  const match = fontFamily.match(/^"([^"]+)"/);
  return match ? (match[1] as string) : null;
}

export type FontFallback = 'sans-serif' | 'serif' | 'monospace' | 'cursive';

/** Construit la valeur CSS font-family stockée à partir du nom saisi par le MSP. */
export function buildFontFamilyValue(name: string, fallback: FontFallback): string {
  return `"${name.trim()}", ${fallback}`;
}

/** Parse une valeur CSS font-family stockée en {name, fallback}, pour préremplir le formulaire d'édition. */
export function parseFontFamilyValue(fontFamily: string | null | undefined): {
  name: string;
  fallback: FontFallback;
} {
  const match = fontFamily?.match(/^"([^"]+)",\s*(sans-serif|serif|monospace|cursive)$/);
  return match
    ? { name: match[1] as string, fallback: match[2] as FontFallback }
    : { name: '', fallback: 'sans-serif' };
}
