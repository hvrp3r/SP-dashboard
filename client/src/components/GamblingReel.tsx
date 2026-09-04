import { useEffect, useRef, useState } from 'react';
import type { Cosmetic, GamblingCrateReward, GamblingCrateRewardView } from '../types.js';
import { RARITY_RING_CLASSES, rarityFromWeightPercent, rewardFallbackEmoji } from '../lib/gamblingLabels.js';
import { cosmeticRewardVisual } from '../lib/cosmeticsLabels.js';
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

function pickWeighted(pool: GamblingCrateRewardView[]): GamblingCrateRewardView {
  const total = pool.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of pool) {
    roll -= r.weight;
    if (roll < 0) return r;
  }
  return pool[pool.length - 1] as GamblingCrateRewardView;
}

/** Remplit la bande avec des tirages aléatoires du pool (préfixe + segment de
 * tirage), sauf à l'index gagnant où le vrai résultat (déjà connu côté serveur)
 * est placé pour que l'animation s'arrête pile sur lui. */
function buildReel(
  pool: GamblingCrateRewardView[],
  winner: GamblingCrateReward
): GamblingCrateRewardView[] {
  const winnerView = pool.find((r) => r.id === winner.id);
  const items: GamblingCrateRewardView[] = [];
  for (let i = 0; i < PREFIX_COUNT; i++) {
    items.push(pickWeighted(pool));
  }
  for (let i = 0; i < REEL_LENGTH; i++) {
    items.push(i === WINNING_INDEX ? (winnerView ?? { ...winner, weight_percent: 0 }) : pickWeighted(pool));
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
}: GamblingReelProps) {
  const [items, setItems] = useState<GamblingCrateRewardView[]>([]);
  const [landed, setLanded] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spinToken === 0) return;

    setItems(buildReel(pool, winner));
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
        {items.map((item, i) => {
          const isWinnerSlot = i === TOTAL_WINNING_INDEX;
          const rarity = rarityFromWeightPercent(item.weight_percent);
          return (
            <div
              key={i}
              className="flex-shrink-0 flex flex-col items-center justify-center gap-1.5 px-1"
              style={{ width: ITEM_WIDTH }}
            >
              <div
                className={`w-24 h-24 rounded-lg flex items-center justify-center text-4xl bg-zinc-800 overflow-hidden ${
                  isWinnerSlot && landed ? RARITY_RING_CLASSES[rarity] : ''
                }`}
                style={isWinnerSlot && landed ? { animation: 'popIn 0.35s ease-out' } : undefined}
              >
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                ) : item.type === 'cosmetic' ? (
                  (() => {
                    const exact = item.cosmetic_id
                      ? cosmeticCatalog.find((c) => c.id === item.cosmetic_id)
                      : null;
                    const visual = cosmeticRewardVisual(
                      exact?.slot ?? item.cosmetic_slot_filter,
                      exact?.rarity ?? item.cosmetic_rarity_filter
                    );
                    return <span className={visual.textClass}>{visual.icon}</span>;
                  })()
                ) : (
                  rewardFallbackEmoji(item.type)
                )}
              </div>
              <p className="w-full text-[11px] text-zinc-400 text-center truncate">{item.title}</p>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-emerald-400/80" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-zinc-950 via-transparent to-zinc-950" />
    </div>
  );
}
