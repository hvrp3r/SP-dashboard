import { useEffect, useRef, useState } from 'react';
import type {
  Cosmetic,
  CosmeticRarity,
  GamblingCrateReward,
  GamblingCrateRewardView,
} from '../types.js';
import { RARITY_RING_CLASSES, rarityFromWeightPercent, rewardFallbackEmoji } from '../lib/gamblingLabels.js';
import {
  cosmeticRewardVisual,
  RARITY_RING_CLASSES as COSMETIC_RARITY_RING_CLASSES,
} from '../lib/cosmeticsLabels.js';
import { playReveal, playTick } from '../lib/sound.js';

const ITEM_WIDTH = 128;
/** Items de remplissage placés avant le segment "tirage" : à l'instant où le
 * défilement démarre, le marqueur repose déjà au milieu de cette bande, avec
 * des items visibles des deux côtés (pas de vide à gauche). */
const PREFIX_COUNT = 8;
const REEL_LENGTH = 36;
const WINNING_INDEX = 28;
/** Index absolu du gagnant dans le tableau complet (préfixe + segment tirage). */
const TOTAL_WINNING_INDEX = PREFIX_COUNT + WINNING_INDEX;
/** Index au repos, avant que le défilement ne démarre. */
const REST_INDEX = PREFIX_COUNT - 1;
const SPIN_DURATION_MS = 6200;

interface ReelItem {
  reward: GamblingCrateRewardView;
  /** Cosmétique de "figuration" tiré au hasard pour peupler visuellement cet
   * emplacement du rouleau (jamais le vrai gain — juste du décor). */
  cosmetic: Cosmetic | null;
}

function pickRewardRow(pool: GamblingCrateRewardView[]): GamblingCrateRewardView {
  const total = pool.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of pool) {
    roll -= r.weight;
    if (roll < 0) return r;
  }
  return pool[pool.length - 1] as GamblingCrateRewardView;
}

/** Tire un cosmétique concret pour peupler un emplacement du rouleau — exact
 * si la récompense en pointe un, sinon pondéré par rareté dans son pool
 * catégorie/rareté (même logique que cosmetics.service.ts#pickRandomCosmeticForPool
 * côté serveur). Purement décoratif : jamais utilisé pour le vrai résultat. */
function pickCosmeticForReward(
  reward: GamblingCrateRewardView,
  catalog: Cosmetic[],
  weights: Record<CosmeticRarity, number>
): Cosmetic | null {
  if (reward.type !== 'cosmetic') return null;
  if (reward.cosmetic_id) {
    return catalog.find((c) => c.id === reward.cosmetic_id) ?? null;
  }
  const candidates = catalog.filter(
    (c) =>
      !c.is_default &&
      (reward.cosmetic_slot_filter === null || c.slot === reward.cosmetic_slot_filter) &&
      (reward.cosmetic_rarity_filter === null || c.rarity === reward.cosmetic_rarity_filter)
  );
  if (candidates.length === 0) return null;

  const totalWeight = candidates.reduce((sum, c) => sum + (weights[c.rarity] ?? 0), 0);
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }
  let roll = Math.random() * totalWeight;
  for (const c of candidates) {
    roll -= weights[c.rarity] ?? 0;
    if (roll < 0) return c;
  }
  return candidates[candidates.length - 1] ?? null;
}

function pickReelItem(
  pool: GamblingCrateRewardView[],
  catalog: Cosmetic[],
  weights: Record<CosmeticRarity, number>
): ReelItem {
  const reward = pickRewardRow(pool);
  return { reward, cosmetic: pickCosmeticForReward(reward, catalog, weights) };
}

/** Remplit la bande avec des tirages aléatoires du pool, sauf à l'emplacement
 * où le rouleau va s'arrêter : le vrai gain (`winner`/`winnerCosmetic`, déjà
 * connu côté serveur) y est placé dès la construction — ce qui s'arrête sous
 * le marqueur EST le résultat, jamais un autre cosmétique substitué après
 * coup. Seule sa *présentation* (icône/bordure/nom) reste masquée tant que
 * `landed` est faux (voir le rendu plus bas), pour ne rien laisser deviner
 * avant l'arrêt sans jamais désynchroniser l'objet affiché du vrai résultat. */
function buildReel(
  pool: GamblingCrateRewardView[],
  catalog: Cosmetic[],
  weights: Record<CosmeticRarity, number>,
  winner: GamblingCrateReward,
  winnerCosmetic: Cosmetic | null
): ReelItem[] {
  const winnerWeightPercent = pool.find((r) => r.id === winner.id)?.weight_percent ?? 0;
  const winnerItem: ReelItem = {
    reward: { ...winner, weight_percent: winnerWeightPercent },
    cosmetic: winnerCosmetic,
  };

  const items: ReelItem[] = [];
  for (let i = 0; i < PREFIX_COUNT; i++) {
    items.push(pickReelItem(pool, catalog, weights));
  }
  for (let i = 0; i < REEL_LENGTH; i++) {
    items.push(i === WINNING_INDEX ? winnerItem : pickReelItem(pool, catalog, weights));
  }
  return items;
}

/** Départ très lent, accélération vers le milieu, puis long freinage progressif —
 * comme une roue lâchée qui perd de la vitesse par friction. */
function spinEase(t: number): number {
  return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2;
}

interface GamblingReelProps {
  pool: GamblingCrateRewardView[];
  winner: GamblingCrateReward;
  /** Incrémenter pour déclencher un nouveau tirage animé. */
  spinToken: number;
  onLanded: () => void;
  cosmeticCatalog: Cosmetic[];
  /** Cosmétique réellement tiré par le serveur pour le gain gagnant — seule
   * source fiable de sa rareté pour une récompense "pool" (dont le filtre ne
   * fixe pas forcément une rareté précise), `null` si le gain n'est pas un
   * cosmétique. */
  winnerCosmetic: Cosmetic | null;
  /** Poids de tirage par rareté, pour peupler le rouleau de figuration —
   * `null` tant que non chargé, retombe alors sur un tirage uniforme. */
  rarityWeights: Record<CosmeticRarity, number> | null;
}

function offsetForIndex(index: number): number {
  return index * ITEM_WIDTH + ITEM_WIDTH / 2;
}

export default function GamblingReel({
  pool,
  winner,
  spinToken,
  onLanded,
  cosmeticCatalog,
  winnerCosmetic,
  rarityWeights,
}: GamblingReelProps) {
  const [items, setItems] = useState<ReelItem[]>([]);
  const [landed, setLanded] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spinToken === 0) return;

    setItems(
      buildReel(
        pool,
        cosmeticCatalog,
        rarityWeights ?? ({} as Record<CosmeticRarity, number>),
        winner,
        winnerCosmetic
      )
    );
    setLanded(false);

    const startOffset = offsetForIndex(REST_INDEX);
    const target = offsetForIndex(TOTAL_WINNING_INDEX);
    const distance = target - startOffset;
    const winnerRarity = rarityFromWeightPercent(
      pool.find((r) => r.id === winner.id)?.weight_percent ?? 100
    );

    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${-startOffset}px)`;
    }

    let rafId = 0;
    let startTime = 0;
    let lastCrossedIndex = REST_INDEX;

    const step = (now: number) => {
      if (!startTime) startTime = now;
      const t = Math.min(1, (now - startTime) / SPIN_DURATION_MS);
      const currentOffset = startOffset + spinEase(t) * distance;

      if (trackRef.current) {
        trackRef.current.style.transform = `translateX(${-currentOffset}px)`;
      }

      // Un tic exactement quand un nouvel item franchit le marqueur central — la
      // sync audio/visuel dérive de la même valeur d'offset que le rendu, frame par frame.
      const currentIndex = Math.min(TOTAL_WINNING_INDEX, Math.floor(currentOffset / ITEM_WIDTH));
      if (currentIndex > lastCrossedIndex) {
        for (let i = lastCrossedIndex + 1; i <= currentIndex; i++) {
          if (i < TOTAL_WINNING_INDEX) playTick();
        }
        lastCrossedIndex = currentIndex;
      }

      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setLanded(true);
        playReveal(winnerRarity);
        onLanded();
      }
    };

    rafId = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinToken]);

  if (items.length === 0) return null;

  return (
    <div className="relative w-full h-36 overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800">
      <div
        ref={trackRef}
        className="absolute inset-y-0 left-1/2 flex items-center"
        style={{ transform: `translateX(${-offsetForIndex(REST_INDEX)}px)` }}
      >
        {items.map(({ reward, cosmetic }, i) => {
          const isWinnerSlot = i === TOTAL_WINNING_INDEX;
          // L'emplacement gagnant porte le vrai résultat dès la construction
          // (voir buildReel) et l'affiche identiquement pendant tout le
          // défilement — seul un halo supplémentaire s'ajoute une fois le
          // rouleau arrêté dessus, pour souligner la révélation sans jamais
          // faire apparaître un autre cosmétique que le gain final.
          const genericRarity = rarityFromWeightPercent(reward.weight_percent);

          let visual: { icon: string; textClass: string; borderClass: string } | null = null;
          let resolvedRarity: CosmeticRarity | null = null;
          if (reward.type === 'cosmetic') {
            resolvedRarity = cosmetic?.rarity ?? reward.cosmetic_rarity_filter;
            visual = cosmeticRewardVisual(cosmetic?.slot ?? reward.cosmetic_slot_filter, resolvedRarity);
          }

          const landedGlowClass =
            isWinnerSlot && landed
              ? reward.type === 'cosmetic'
                ? resolvedRarity
                  ? COSMETIC_RARITY_RING_CLASSES[resolvedRarity]
                  : 'ring-2 ring-zinc-500'
                : RARITY_RING_CLASSES[genericRarity]
              : '';

          const title = cosmetic?.name ?? reward.title;
          const imageUrl = cosmetic?.image_url ?? reward.image_url;

          return (
            <div
              key={i}
              className="flex-shrink-0 flex flex-col items-center justify-center gap-1.5 px-1"
              style={{ width: ITEM_WIDTH }}
            >
              <div
                className={`w-24 h-24 rounded-lg flex items-center justify-center text-4xl bg-zinc-800 overflow-hidden ${
                  visual ? `border ${visual.borderClass}` : ''
                } ${landedGlowClass}`}
                style={isWinnerSlot && landed ? { animation: 'popIn 0.35s ease-out' } : undefined}
              >
                {imageUrl ? (
                  <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                ) : visual ? (
                  <span className={visual.textClass}>{visual.icon}</span>
                ) : (
                  rewardFallbackEmoji(reward.type)
                )}
              </div>
              <p className="w-full text-[11px] text-zinc-400 text-center truncate">{title}</p>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-emerald-400/80" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-zinc-950 via-transparent to-zinc-950" />
    </div>
  );
}
