import type { CosmeticRarity, CosmeticSlot } from '../types.js';
import type { FontFallback } from './googleFonts.js';

export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  avatar_frame: 'Cadre d\'avatar',
  banner: 'Bannière de profil',
  name_color: 'Couleur de pseudo',
  title: 'Titre',
  name_font: 'Police de pseudo',
};

/**
 * Suggestions de noms Google Fonts (boutons de remplissage rapide) — pas une
 * liste fermée : le MSP peut taper n'importe quel nom de police Google Fonts
 * valide, chargée à la volée (voir client/src/lib/googleFonts.ts).
 */
export const SUGGESTED_FONTS = ['Bangers', 'Press Start 2P', 'Pacifico', 'Orbitron', 'Permanent Marker'];

export const FONT_FALLBACK_LABELS: Record<FontFallback, string> = {
  'sans-serif': 'Sans-serif (par défaut)',
  serif: 'Serif',
  monospace: 'Monospace',
  cursive: 'Cursive / manuscrite',
};

/** Forme courte de SLOT_LABELS, pour composer un libellé de récompense "pool" (ex: "Titre + Épique"). */
const SHORT_SLOT_LABELS: Record<CosmeticSlot, string> = {
  avatar_frame: 'Cadre',
  banner: 'Bannière',
  name_color: 'Couleur',
  title: 'Titre',
  name_font: 'Police',
};

/** Icône générique par catégorie — utilisée comme visuel par défaut d'un gain
 * cosmétique de caisse gambling qui n'a pas d'image configurée. */
export const SLOT_ICONS: Record<CosmeticSlot, string> = {
  avatar_frame: '⭕',
  banner: '🖼️',
  name_color: '🎨',
  title: '🏷️',
  name_font: '🔤',
};

/**
 * Libellé suggéré pour une récompense de caisse "pool" (catégorie et/ou
 * rareté, cosmétique précis tiré au hasard à l'ouverture) — ex: "Titre +
 * Épique", "Cadre" (toutes raretés), "Épique" (toutes catégories).
 */
export function poolRewardLabel(
  slotFilter: CosmeticSlot | null,
  rarityFilter: CosmeticRarity | null
): string {
  const parts = [
    slotFilter ? SHORT_SLOT_LABELS[slotFilter] : null,
    rarityFilter ? RARITY_LABELS[rarityFilter] : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' + ') : 'Cosmétique surprise';
}

/** Ordre canonique des raretés — du moins rare au plus rare. */
export const RARITIES: CosmeticRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_LABELS: Record<CosmeticRarity, string> = {
  common: 'Commun',
  uncommon: 'Peu commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
};

export const RARITY_BORDER_CLASSES: Record<CosmeticRarity, string> = {
  common: 'border-zinc-700',
  uncommon: 'border-green-500/60',
  rare: 'border-blue-500/60',
  epic: 'border-violet-500/60',
  legendary: 'border-amber-400',
};

export const RARITY_TEXT_CLASSES: Record<CosmeticRarity, string> = {
  common: 'text-zinc-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  epic: 'text-violet-400',
  legendary: 'text-amber-400',
};

/**
 * Visuel par défaut d'un gain cosmétique de caisse gambling sans image
 * configurée : icône selon la catégorie (précise, ou filtre de la récompense
 * "pool"), couleur selon la rareté. `null` sur un axe (ex: pool "Épique"
 * toutes catégories, ou "Cadre" toutes raretés) retombe sur un visuel neutre
 * pour cet axe — délibérément **distinct** du gris de la rareté Commune
 * (bordure pointillée + gris plus clair) pour ne pas laisser croire que le
 * pool est garanti Commun alors qu'il couvre toutes les raretés.
 */
export function cosmeticRewardVisual(
  slot: CosmeticSlot | null,
  rarity: CosmeticRarity | null
): { icon: string; textClass: string; borderClass: string } {
  return {
    icon: slot ? SLOT_ICONS[slot] : '✨',
    textClass: rarity ? RARITY_TEXT_CLASSES[rarity] : 'text-zinc-100',
    borderClass: rarity ? RARITY_BORDER_CLASSES[rarity] : 'border-dashed border-zinc-500',
  };
}
