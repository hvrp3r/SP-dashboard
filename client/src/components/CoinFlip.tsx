import { useEffect, useState } from 'react';
import UserNameTag from './UserNameTag.jsx';
import { playCoinBounce, playCoinReveal, playCoinToss } from '../lib/sound.js';
import type { Challenge } from '../types.js';

const SPIN_TURNS = 5;
const FLIP_DURATION_MS = 3200;
const FLIP_EASING = 'ease-in-out';
// Combien de temps garder le résultat affiché une fois la pièce posée, avant que le
// parent ne bascule vers l'affichage normal du défi résolu.
const REVEAL_HOLD_MS = 5200;

const COIN_SIZE = 112;

const FACES: Record<'pile' | 'face', { label: string; emoji: string }> = {
  pile: { label: 'PILE', emoji: '😊' },
  face: { label: 'FACE', emoji: '⭐' },
};

function CoinFace({ side, start, end, glintDelay }: { side: 'pile' | 'face'; start: string; end: string; glintDelay: number }) {
  const { label, emoji } = FACES[side];
  return (
    <div
      className="absolute inset-0 rounded-full"
      style={
        {
          backfaceVisibility: 'hidden',
          animation: `coinBounceFlip ${FLIP_DURATION_MS}ms ${FLIP_EASING} forwards`,
          '--coin-start': start,
          '--coin-end': end,
          border: '3px solid #78350f',
          boxShadow: '0 12px 22px rgba(0,0,0,0.5), 0 0 0 2px rgba(161,98,7,0.55)',
        } as React.CSSProperties
      }
    >
      <div
        className="absolute inset-0 rounded-full overflow-hidden flex flex-col items-center justify-center gap-0.5"
        style={{
          background:
            'radial-gradient(circle at 34% 26%, #fff6d8 0%, #fcd34d 32%, #eab308 66%, #92400e 100%)',
          boxShadow:
            'inset 0 0 0 6px rgba(255,247,214,0.3), inset 0 -12px 18px rgba(120,53,15,0.55), inset 0 6px 10px rgba(255,255,255,0.45)',
        }}
      >
        <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{emoji}</span>
        <span
          className="font-black tracking-[0.15em] select-none"
          style={{
            fontSize: '0.6rem',
            color: '#78350f',
            textShadow: '0 1px 0 rgba(255,241,194,0.6)',
          }}
        >
          {label}
        </span>
        <div
          className="absolute inset-y-0 w-1/3"
          style={{
            background:
              'linear-gradient(75deg, transparent, rgba(255,255,255,0.75), transparent)',
            animation: `coinGlint ${FLIP_DURATION_MS * 0.32}ms linear ${glintDelay}ms 3`,
          }}
        />
      </div>
    </div>
  );
}

/** Durée totale à laisser au parent avant de considérer l'animation + la révélation terminées. */
export const COIN_FLIP_DURATION_MS = FLIP_DURATION_MS + REVEAL_HOLD_MS;

export default function CoinFlip({ challenge }: { challenge: Challenge }) {
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    playCoinToss();
    // Rebonds synchronisés avec les paliers "au sol" de coinBounceFlip (58%, 82%, 100%),
    // en amplitude décroissante — voir index.css pour le détail des keyframes.
    playCoinBounce((FLIP_DURATION_MS * 0.58) / 1000, 1);
    playCoinBounce((FLIP_DURATION_MS * 0.82) / 1000, 0.55);
    playCoinBounce(FLIP_DURATION_MS / 1000, 0.3);

    const t = setTimeout(() => {
      setLanded(true);
      playCoinReveal();
    }, FLIP_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  const challenger = challenge.participants.find((p) => p.is_challenger);
  const winnerIsChallenger = challenge.winner_id === challenger?.user_id;
  const winner = challenge.participants.find((p) => p.user_id === challenge.winner_id);
  const pot =
    challenge.wager_amount * challenge.participants.filter((p) => p.status === 'accepted').length;

  const baseDeg = SPIN_TURNS * 360;
  const finalDeg = winnerIsChallenger ? baseDeg : baseDeg + 180;

  return (
    <div className="flex flex-col items-center py-3">
      <div
        className="relative"
        style={{ width: COIN_SIZE, height: COIN_SIZE, perspective: '800px' }}
      >
        <CoinFace side="pile" start="0deg" end={`${finalDeg}deg`} glintDelay={100} />
        <CoinFace side="face" start="180deg" end={`${finalDeg + 180}deg`} glintDelay={280} />
      </div>
      <div
        className="mt-2 rounded-full bg-black"
        style={{
          width: COIN_SIZE * 0.5,
          height: 8,
          animation: `coinBounceShadow ${FLIP_DURATION_MS}ms ease-in-out forwards`,
        }}
      />
      {!landed ? (
        <p className="mt-3 text-xs text-zinc-500 animate-pulse">La pièce tourne…</p>
      ) : (
        <p className="mt-3 text-sm" style={{ animation: 'popIn 0.35s ease-out' }}>
          <span className="text-emerald-400 font-semibold">
            {winner ? (
              <UserNameTag username={winner.username} equipped={winner.equipped_cosmetics} className="text-emerald-400" />
            ) : (
              '???'
            )}
          </span>
          <span className="text-zinc-400"> remporte {pot} SP !</span>
        </p>
      )}
    </div>
  );
}
