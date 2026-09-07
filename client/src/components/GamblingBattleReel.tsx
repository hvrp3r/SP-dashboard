import { useMemo } from 'react';
import type {
  Cosmetic,
  CosmeticRarity,
  GamblingBattleOpenEntry,
  GamblingCrateRewardView,
  GamblingRewardType,
} from '../types.js';
import { RARITY_RING_CLASSES, RARITY_TEXT_CLASSES, rarityFromWeightPercent, rewardFallbackEmoji } from '../lib/gamblingLabels.js';
import {
  cosmeticRewardVisual,
  RARITY_RING_CLASSES as COSMETIC_RARITY_RING_CLASSES,
  RARITY_TEXT_CLASSES as COSMETIC_RARITY_TEXT_CLASSES,
} from '../lib/cosmeticsLabels.js';

/** Pas vertical entre deux emplacements du rouleau (base du calcul de décalage). */
const ITEM_HEIGHT = 120;
/** Hauteur de la fenêtre visible — volontairement plus grande qu'ITEM_HEIGHT
 * pour laisser deviner le haut du prochain emplacement et le bas du précédent
 * pendant le défilement (même effet "rouleau" que l'horizontal GamblingReel,
 * où le viewport est aussi bien plus grand que chaque item) : une fenêtre
 * pile à la taille d'un item donne l'impression que l'image est rognée. */
const VIEWPORT_HEIGHT = 190;
/** Un seul rouleau "en cours" à la fois s'affiche désormais par joueur (les
 * autres caisses ne sont que des puces avant/après, voir GamblingBattleDetail.tsx)
 * — peut donc se permettre d'être bien plus grand et détaillé qu'un empilement
 * de tous les tirages. */
const PREFIX_COUNT = 4;
const REEL_LENGTH = 14;
const WINNING_INDEX = 10;
const TOTAL_WINNING_INDEX = PREFIX_COUNT + WINNING_INDEX;
const REST_INDEX = PREFIX_COUNT - 1;
/** Distance parcourue, en nombre d'emplacements, entre le repos et l'arrêt —
 * exportée pour que le parent (qui pilote une seule horloge partagée pour
 * toutes les colonnes) puisse déclencher un tic sonore par emplacement
 * franchi, en phase avec l'accélération/le freinage de `spinEase` ci-dessous. */
export const REEL_TRAVEL_ITEMS = TOTAL_WINNING_INDEX - REST_INDEX;

interface ReelItem {
  title: string;
  imageUrl: string | null;
  type: GamblingRewardType;
  weightPercent: number;
  cosmetic: Cosmetic | null;
}

function pickFillerRow(pool: GamblingCrateRewardView[]): GamblingCrateRewardView {
  const total = pool.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of pool) {
    roll -= r.weight;
    if (roll < 0) return r;
  }
  return pool[pool.length - 1] as GamblingCrateRewardView;
}

function pickFillerCosmetic(
  reward: GamblingCrateRewardView,
  catalog: Cosmetic[],
  weights: Record<CosmeticRarity, number>
): Cosmetic | null {
  if (reward.type !== 'cosmetic') return null;
  if (reward.cosmetic_id) return catalog.find((c) => c.id === reward.cosmetic_id) ?? null;
  const candidates = catalog.filter(
    (c) =>
      !c.is_default &&
      (reward.cosmetic_slot_filter === null || c.slot === reward.cosmetic_slot_filter) &&
      (reward.cosmetic_rarity_filter === null || c.rarity === reward.cosmetic_rarity_filter)
  );
  if (candidates.length === 0) return null;
  const totalWeight = candidates.reduce((sum, c) => sum + (weights[c.rarity] ?? 0), 0);
  if (totalWeight <= 0) return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  let roll = Math.random() * totalWeight;
  for (const c of candidates) {
    roll -= weights[c.rarity] ?? 0;
    if (roll < 0) return c;
  }
  return candidates[candidates.length - 1] ?? null;
}

function pickFiller(
  pool: GamblingCrateRewardView[],
  catalog: Cosmetic[],
  weights: Record<CosmeticRarity, number>
): ReelItem {
  const reward = pickFillerRow(pool);
  return {
    title: reward.title,
    imageUrl: reward.image_url,
    type: reward.type,
    weightPercent: reward.weight_percent,
    cosmetic: pickFillerCosmetic(reward, catalog, weights),
  };
}

/**
 * Même principe que buildReel dans GamblingReel.tsx : le résultat (déjà connu
 * côté serveur, voir GamblingBattleOpenEntry) est placé dès la construction à
 * l'emplacement où le rouleau va s'arrêter — seule sa présentation reste
 * masquée par l'animation, jamais substitué après coup.
 */
function buildReel(
  pool: GamblingCrateRewardView[],
  catalog: Cosmetic[],
  weights: Record<CosmeticRarity, number>,
  result: GamblingBattleOpenEntry
): ReelItem[] {
  const winnerWeightPercent = pool.find((r) => r.id === result.reward_id)?.weight_percent ?? 0;
  const winnerItem: ReelItem = {
    title: result.reward_title,
    imageUrl: result.reward_image_url,
    type: result.reward_type,
    weightPercent: winnerWeightPercent,
    cosmetic: result.resolved_cosmetic,
  };

  const items: ReelItem[] = [];
  for (let i = 0; i < PREFIX_COUNT; i++) items.push(pickFiller(pool, catalog, weights));
  for (let i = 0; i < REEL_LENGTH; i++) {
    items.push(i === WINNING_INDEX ? winnerItem : pickFiller(pool, catalog, weights));
  }
  return items;
}

/** Départ lent, accélération, long freinage — identique à GamblingReel.tsx. */
function spinEase(t: number): number {
  return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2;
}

/** Nombre d'emplacements déjà franchis à un instant `progress` (0..1) donné —
 * dérivé de la même easing que le rendu visuel, pour que le parent puisse en
 * déduire des tics sonores exactement en phase avec le rouleau. */
export function reelTravelledItems(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return spinEase(clamped) * REEL_TRAVEL_ITEMS;
}

function offsetForIndex(index: number): number {
  return index * ITEM_HEIGHT + ITEM_HEIGHT / 2;
}

interface GamblingBattleReelProps {
  pool: GamblingCrateRewardView[];
  result: GamblingBattleOpenEntry;
  /** 0 (départ) à 1 (posé) — piloté par l'horloge partagée du parent (voir
   * GamblingBattleDetail.tsx), pas par une boucle d'animation locale : toutes
   * les colonnes d'une même bataille doivent s'arrêter exactement au même
   * instant, un seul tick partagé garantit cette synchronisation. Une
   * transition CSS (voir plus bas) lisse le mouvement entre deux mises à
   * jour de cette prop plutôt que de dépendre d'une fréquence de tick élevée. */
  progress: number;
  /** Durée (ms) entre deux mises à jour de `progress` côté parent — sert de
   * durée à la transition CSS, pour qu'elle recouvre exactement l'intervalle
   * et ne "rattrape" jamais complètement avant la valeur suivante. */
  tickIntervalMs: number;
  cosmeticCatalog: Cosmetic[];
  rarityWeights: Record<CosmeticRarity, number> | null;
}

export default function GamblingBattleReel({
  pool,
  result,
  progress,
  tickIntervalMs,
  cosmeticCatalog,
  rarityWeights,
}: GamblingBattleReelProps) {
  const items = useMemo(
    () => buildReel(pool, cosmeticCatalog, rarityWeights ?? ({} as Record<CosmeticRarity, number>), result),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.participant_id, result.position, result.reward_id]
  );

  const clamped = Math.min(1, Math.max(0, progress));
  const startOffset = offsetForIndex(REST_INDEX);
  const target = offsetForIndex(TOTAL_WINNING_INDEX);
  const offset = startOffset + spinEase(clamped) * (target - startOffset);
  const landed = clamped >= 1;
  const winnerItem = items[TOTAL_WINNING_INDEX];
  const winnerTitle = winnerItem?.cosmetic?.name ?? winnerItem?.title ?? '';
  const winnerRarity = winnerItem
    ? winnerItem.type === 'cosmetic'
      ? (winnerItem.cosmetic?.rarity ?? null)
      : rarityFromWeightPercent(winnerItem.weightPercent)
    : null;
  const winnerTitleClass =
    winnerItem?.type === 'cosmetic'
      ? winnerRarity
        ? COSMETIC_RARITY_TEXT_CLASSES[winnerRarity as CosmeticRarity]
        : 'text-zinc-300'
      : RARITY_TEXT_CLASSES[winnerRarity as 'legendary' | 'rare' | 'common'];

  return (
    <div className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800"
        style={{ height: VIEWPORT_HEIGHT }}
      >
        <div
          className="absolute inset-x-0 top-1/2 flex flex-col items-center"
          style={{
            transform: `translateY(${-offset}px)`,
            transition: `transform ${tickIntervalMs * 1.15}ms linear`,
          }}
        >
          {items.map((item, i) => {
            const isWinnerSlot = i === TOTAL_WINNING_INDEX;
            const genericRarity = rarityFromWeightPercent(item.weightPercent);

            let visual: { icon: string; textClass: string; borderClass: string } | null = null;
            let resolvedRarity: CosmeticRarity | null = null;
            if (item.type === 'cosmetic') {
              resolvedRarity = item.cosmetic?.rarity ?? null;
              visual = cosmeticRewardVisual(item.cosmetic?.slot ?? null, resolvedRarity);
            }

            const landedGlowClass =
              isWinnerSlot && landed
                ? item.type === 'cosmetic'
                  ? resolvedRarity
                    ? COSMETIC_RARITY_RING_CLASSES[resolvedRarity]
                    : 'ring-2 ring-zinc-500'
                  : RARITY_RING_CLASSES[genericRarity]
                : '';

            const imageUrl = item.cosmetic?.image_url ?? item.imageUrl;

            return (
              <div
                key={i}
                className="w-full flex-shrink-0 flex items-center justify-center"
                style={{ height: ITEM_HEIGHT }}
              >
                <div
                  className={`w-24 h-24 rounded-xl flex items-center justify-center text-4xl bg-zinc-800 overflow-hidden flex-shrink-0 transition-transform ${
                    visual ? `border-2 ${visual.borderClass}` : ''
                  } ${landedGlowClass}`}
                  style={isWinnerSlot && landed ? { animation: 'popIn 0.3s ease-out' } : undefined}
                >
                  {imageUrl ? (
                    <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : visual ? (
                    <span className={visual.textClass}>{visual.icon}</span>
                  ) : (
                    rewardFallbackEmoji(item.type)
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-950 via-transparent to-zinc-950" />
      </div>
      {landed && winnerItem && (
        <div className="mt-1.5 text-center" style={{ animation: 'fadeIn 0.25s ease-out' }}>
          <p className={`text-sm font-bold truncate ${winnerTitleClass}`}>{winnerTitle}</p>
          {winnerItem.type === 'sp' && (
            <p className="text-emerald-400 font-bold">+{result.sp_amount} SP</p>
          )}
        </div>
      )}
    </div>
  );
}
