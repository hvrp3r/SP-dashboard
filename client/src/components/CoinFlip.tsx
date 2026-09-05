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

const COIN_SIZE = 128;

const FACES: Record<'pile' | 'face', { label: string; emoji: string }> = {
  pile: { label: 'PILE', emoji: '😊' },
  face: { label: 'FACE', emoji: '⭐' },
};

type Metal = 'gold' | 'silver';

interface MetalStyle {
  gradient: string;
  shadow: string;
  border: string;
  ringAccent: string;
  reedLight: string;
  reedDark: string;
}

const METAL_STYLES: Record<Metal, MetalStyle> = {
  gold: {
    gradient:
      'radial-gradient(circle at 33% 23%, #fff6d1 0%, #ffe27a 16%, #eab308 38%, #b45309 62%, #78350f 88%, #5c2e0a 100%)',
    shadow:
      'inset 0 0 0 3px rgba(255,246,209,0.45), inset 0 -11px 18px rgba(92,46,10,0.65), inset 0 6px 10px rgba(255,255,255,0.4)',
    border: '#5c2e0a',
    ringAccent: 'rgba(234,179,8,0.5)',
    reedLight: '#ffe9a8',
    reedDark: '#5c2e0a',
  },
  silver: {
    gradient:
      'radial-gradient(circle at 33% 23%, #ffffff 0%, #f4f4f5 16%, #d4d4d8 38%, #a1a1aa 62%, #52525b 88%, #27272a 100%)',
    shadow:
      'inset 0 0 0 3px rgba(255,255,255,0.5), inset 0 -11px 18px rgba(39,39,42,0.65), inset 0 6px 10px rgba(255,255,255,0.45)',
    border: '#27272a',
    ringAccent: 'rgba(161,161,170,0.55)',
    reedLight: '#f4f4f5',
    reedDark: '#27272a',
  },
};

// Comme sur les vraies pièces bicolores (1€ = anneau or/centre argent, 2€ =
// l'inverse) : "pile" et "face" échangent quel métal va sur l'anneau et lequel
// va sur le disque central, plutôt que d'avoir deux fois la même combinaison.
const RING_METAL: Record<'pile' | 'face', Metal> = { pile: 'gold', face: 'silver' };
const DISC_METAL: Record<'pile' | 'face', Metal> = { pile: 'silver', face: 'gold' };

// Couronne de petits points façon étoiles gravées, comme sur une vraie pièce —
// calculée une seule fois, indépendante du côté affiché.
const RIM_DOT_ANGLES = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);

/** Tranche striée de l'anneau extérieur — deux cercles en tirets décalés d'un cran
 * pour alterner un ton clair et un ton foncé, à l'échelle de la pièce entière
 * (contrairement à CoinEngraving qui est à l'échelle du disque central). */
function CoinRimReeding({ light, dark }: { light: string; dark: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="48" fill="none" stroke={light} strokeWidth="2.8" strokeDasharray="1.7 1.7" opacity="0.8" />
      <circle cx="50" cy="50" r="48" fill="none" stroke={dark} strokeWidth="2.8" strokeDasharray="1.7 1.7" strokeDashoffset="1.7" opacity="0.6" />
    </svg>
  );
}

/** Gravures du disque central (filets concentriques, couronne de points) — neutres,
 * elles se voient aussi bien sur le disque argenté que doré selon le côté (voir
 * DISC_METAL). Décoratif uniquement, ne doit jamais intercepter les clics. */
function CoinEngraving() {
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      {/* Double filet intérieur, en retrait du bord (le disque argenté central est
          déjà en retrait de l'anneau doré — voir CoinFace). */}
      <circle cx="50" cy="50" r="41" fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.55" />
      <circle cx="50" cy="50" r="39.5" fill="none" stroke="#27272a" strokeWidth="0.7" opacity="0.4" />
      {/* Couronne de points gravés, alternant deux tons pour un léger reflet doré. */}
      {RIM_DOT_ANGLES.map((angle, i) => (
        <circle
          key={i}
          cx={50 + Math.cos(angle) * 35}
          cy={50 + Math.sin(angle) * 35}
          r="1.25"
          fill={i % 2 === 0 ? '#27272a' : '#92400e'}
          opacity={i % 2 === 0 ? 0.45 : 0.35}
        />
      ))}
      {/* Filet autour de l'emblème central. */}
      <circle cx="50" cy="50" r="27" fill="none" stroke="#27272a" strokeWidth="0.6" opacity="0.35" />
    </svg>
  );
}

function CoinFace({ side, start, end, glintDelay }: { side: 'pile' | 'face'; start: string; end: string; glintDelay: number }) {
  const { label, emoji } = FACES[side];
  const ring = METAL_STYLES[RING_METAL[side]];
  const disc = METAL_STYLES[DISC_METAL[side]];
  return (
    <div
      className="absolute inset-0 rounded-full"
      style={
        {
          backfaceVisibility: 'hidden',
          animation: `coinBounceFlip ${FLIP_DURATION_MS}ms ${FLIP_EASING} forwards`,
          '--coin-start': start,
          '--coin-end': end,
          border: `3px solid ${ring.border}`,
          boxShadow: `0 14px 26px rgba(0,0,0,0.55), 0 0 0 2px ${ring.ringAccent}`,
        } as React.CSSProperties
      }
    >
      {/* Anneau extérieur, comme sur une pièce bicolore (1€/2€) — inspiré des pièces
          en euro, avec un fort dégradé pour donner du relief plutôt qu'un aplat
          lisse. "pile" et "face" inversent quel métal va sur l'anneau et lequel va
          sur le disque central (voir RING_METAL/DISC_METAL). */}
      <div
        className="absolute inset-0 rounded-full overflow-hidden"
        style={{ background: ring.gradient, boxShadow: ring.shadow }}
      >
        <CoinRimReeding light={ring.reedLight} dark={ring.reedDark} />
        {/* Disque intérieur, en retrait pour laisser voir l'anneau tout autour — le
            contraste des deux métaux et la marche entre eux donnent la profondeur
            qui manquait à un disque uniformément argenté. */}
        <div
          className="absolute rounded-full overflow-hidden flex flex-col items-center justify-center gap-0.5"
          style={{
            inset: '13%',
            background: disc.gradient,
            boxShadow: `${disc.shadow}, inset 0 0 0 5px rgba(0,0,0,0.3)`,
          }}
        >
          <CoinEngraving />
          <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{emoji}</span>
          <span
            className="font-black tracking-[0.15em] select-none"
            style={{
              fontSize: '0.6rem',
              color: '#27272a',
              textShadow: '0 1px 0 rgba(255,255,255,0.7)',
            }}
          >
            {label}
          </span>
        </div>
        <div
          className="absolute inset-y-0 w-1/3"
          style={{
            background:
              'linear-gradient(75deg, transparent, rgba(255,255,255,0.8), transparent)',
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

  const winner = challenge.participants.find((p) => p.user_id === challenge.winner_id);
  // Le camp gagnant est celui du côté qui a été tiré au sort côté serveur, pas celui
  // du challenger — les deux joueurs ont chacun un côté (le défié choisit à
  // l'acceptation, le challenger hérite de l'autre, voir respondToChallenge côté serveur).
  const winnerSide: 'pile' | 'face' = winner?.coin_side ?? 'pile';
  const pot =
    challenge.wager_amount * challenge.participants.filter((p) => p.status === 'accepted').length;

  const baseDeg = SPIN_TURNS * 360;
  const finalDeg = winnerSide === 'pile' ? baseDeg : baseDeg + 180;

  return (
    <div className="flex flex-col items-center py-3">
      {/* Rendu APRÈS la pièce (jamais avant) : coinBounceFlip la fait sauter jusqu'à
          translateY(-90px) en cours d'animation, ce qui recouvrirait tout élément
          placé au-dessus d'elle dans le flux — voir index.css. */}
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
      <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400">
        {challenge.participants.map((p) => (
          <span key={p.id}>
            <UserNameTag username={p.username} equipped={p.equipped_cosmetics} /> :{' '}
            {p.coin_side ? FACES[p.coin_side].emoji : ''} {p.coin_side ? FACES[p.coin_side].label : '???'}
          </span>
        ))}
      </div>
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
