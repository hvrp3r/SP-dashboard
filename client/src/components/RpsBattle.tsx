import { useEffect, useState } from 'react';
import UserNameTag from './UserNameTag.jsx';
import {
  playLose,
  playPush,
  playRpsBeat,
  playWin,
  playWrong,
  playCorrect,
} from '../lib/sound.js';
import type { Challenge, ChallengeParticipant, RpsMove } from '../types.js';

/** Un temps du compte à rebours ("Pierre… Feuille… Ciseaux…"). */
const BEAT_MS = 550;
const COUNTDOWN_WORDS = ['Pierre…', 'Feuille…', 'Ciseaux…'];
const REVEAL_AT_MS = BEAT_MS * COUNTDOWN_WORDS.length;
// Temps d'affichage du résultat de la manche une fois les mains révélées.
const ROUND_HOLD_MS = 2200;
// Temps supplémentaire pour l'écran de fin de partie (dernière manche uniquement).
const FINAL_HOLD_MS = 5000;

/** Durée totale de l'animation d'une manche, à laisser au parent avant de la retirer. */
export const RPS_ROUND_ANIM_MS = REVEAL_AT_MS + ROUND_HOLD_MS;
/** Idem pour la manche qui termine la partie (révélation + écran de résultats). */
export const RPS_FINAL_ANIM_MS = RPS_ROUND_ANIM_MS + FINAL_HOLD_MS;

export const RPS_HANDS: Record<RpsMove, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
export const RPS_NAMES: Record<RpsMove, string> = {
  rock: 'Pierre',
  paper: 'Feuille',
  scissors: 'Ciseaux',
};

/** Le joueur local à gauche, son adversaire à droite (ordre serveur si spectateur). */
function orderPlayers(challenge: Challenge, userId: number): ChallengeParticipant[] {
  const accepted = challenge.participants.filter((p) => p.status === 'accepted');
  return [...accepted].sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId));
}

function scoreAfter(challenge: Challenge, roundCount: number, userId: number): number {
  return challenge.rps_rounds.slice(0, roundCount).filter((r) => r.winner_id === userId).length;
}

/**
 * Main tournée d'un quart de tour pour pointer sur le côté (les emojis pointent
 * vers le haut) — vers la droite pour le joueur de gauche, et vers la gauche pour
 * celui de droite grâce au scaleX(-1) du parent. Le scaleY(-1) retourne la main
 * après la rotation pour qu'elle soit à l'endroit (pouce vers le haut) plutôt
 * que la tête en bas. La transformation est portée par cet élément intérieur pour
 * que les animations du parent (rpsPump, rpsSlam) restent verticales à l'écran.
 */
function SideHand({ hand }: { hand: string }) {
  return (
    <span className="inline-block" style={{ transform: 'scaleY(-1) rotate(90deg)' }}>
      {hand}
    </span>
  );
}

function displayName(p: ChallengeParticipant, userId: number) {
  return p.user_id === userId ? 'Toi' : p.username;
}

/**
 * Animation d'une manche : compte à rebours avec les deux poings qui battent la
 * mesure, puis révélation simultanée des deux coups et du vainqueur de la manche.
 * Si c'est la manche décisive (défi résolu), enchaîne sur l'écran de résultats.
 */
export function RpsRoundReveal({
  challenge,
  roundIndex,
  userId,
}: {
  challenge: Challenge;
  roundIndex: number;
  userId: number;
}) {
  const [beat, setBeat] = useState(0);
  const [phase, setPhase] = useState<'countdown' | 'reveal' | 'final'>('countdown');

  const round = challenge.rps_rounds[roundIndex];
  const isFinal =
    challenge.status === 'resolved' && roundIndex === challenge.rps_rounds.length - 1;
  const players = orderPlayers(challenge, userId);

  useEffect(() => {
    playRpsBeat();
    const timers = [
      ...COUNTDOWN_WORDS.slice(1).map((_, i) =>
        setTimeout(() => {
          setBeat(i + 1);
          playRpsBeat();
        }, BEAT_MS * (i + 1))
      ),
      setTimeout(() => {
        setPhase('reveal');
        playRpsBeat(true);
        const winnerId = challenge.rps_rounds[roundIndex]?.winner_id ?? null;
        if (winnerId === null) playPush();
        else if (winnerId === userId) playCorrect();
        else playWrong();
      }, REVEAL_AT_MS),
    ];
    if (isFinal) {
      timers.push(
        setTimeout(() => {
          setPhase('final');
          if (challenge.winner_id === userId) playWin();
          else playLose();
        }, RPS_ROUND_ANIM_MS)
      );
    }
    return () => timers.forEach(clearTimeout);
    // Animation jouée une seule fois par manche : ne pas relancer sur les re-rendus du polling.
  }, []);

  if (!round) return null;

  if (phase === 'final') {
    return (
      <div style={{ animation: 'popIn 0.4s ease-out' }}>
        <RpsResults challenge={challenge} userId={userId} highlight />
      </div>
    );
  }

  const roundWinner = players.find((p) => p.user_id === round.winner_id);

  return (
    <div className="flex flex-col items-center py-3">
      <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
        Manche {roundIndex + 1}
      </p>
      <div className="flex items-end justify-center gap-10">
        {players.map((p, i) => {
          const move = round.moves[p.user_id];
          const lost = phase === 'reveal' && round.winner_id !== null && round.winner_id !== p.user_id;
          const won = phase === 'reveal' && round.winner_id === p.user_id;
          return (
            <div key={p.id} className="flex flex-col items-center gap-2 w-24">
              <div
                // La main de droite est retournée pour que les deux se fassent face.
                style={{ transform: i === 1 ? 'scaleX(-1)' : undefined }}
              >
                {phase === 'countdown' ? (
                  <span
                    key={`pump-${beat}`}
                    className="block text-5xl select-none"
                    style={{ animation: `rpsPump ${BEAT_MS}ms ease-in-out` }}
                  >
                    <SideHand hand="✊" />
                  </span>
                ) : (
                  <span
                    className={`block text-5xl select-none transition-all duration-300 ${
                      lost ? 'opacity-40 grayscale' : ''
                    } ${won ? 'drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]' : ''}`}
                    style={{ animation: 'rpsSlam 0.35s ease-out' }}
                  >
                    {move ? <SideHand hand={RPS_HANDS[move]} /> : '❔'}
                  </span>
                )}
              </div>
              <span className="text-xs text-zinc-400 text-center">
                <UserNameTag
                  username={displayName(p, userId)}
                  equipped={p.equipped_cosmetics}
                  linkable={false}
                />
              </span>
              {phase === 'reveal' && move && (
                <span
                  className={`text-xs font-semibold ${won ? 'text-emerald-400' : 'text-zinc-500'}`}
                  style={{ animation: 'fadeIn 0.3s ease-out' }}
                >
                  {RPS_NAMES[move]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {phase === 'countdown' ? (
        <p
          key={beat}
          className="mt-4 text-lg font-bold text-sky-300"
          style={{ animation: 'popIn 0.3s ease-out' }}
        >
          {COUNTDOWN_WORDS[beat]}
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-center" style={{ animation: 'popIn 0.35s ease-out' }}>
          <p
            className={`text-lg font-bold ${
              !roundWinner
                ? 'text-amber-400'
                : roundWinner.user_id === userId
                  ? 'text-emerald-400'
                  : 'text-red-400'
            }`}
          >
            {!roundWinner
              ? 'Égalité ! On rejoue'
              : roundWinner.user_id === userId
                ? 'Tu gagnes la manche !'
                : `${roundWinner.username} gagne la manche`}
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            {players.map((p, i) => (
              <span key={p.id}>
                {i > 0 && <span className="text-zinc-400"> – </span>}
                {displayName(p, userId)}{' '}
                <span className="font-semibold text-sky-300">
                  {scoreAfter(challenge, roundIndex + 1, p.user_id)}
                </span>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Récapitulatif d'une partie terminée : score final, vainqueur et gain/perte de
 * SP de chaque joueur (le vainqueur empoche la mise de l'adversaire, le perdant
 * perd sa mise — voir resolveChallenge côté serveur).
 */
export function RpsResults({
  challenge,
  userId,
  highlight = false,
}: {
  challenge: Challenge;
  userId: number;
  highlight?: boolean;
}) {
  const players = orderPlayers(challenge, userId);
  const winner = players.find((p) => p.user_id === challenge.winner_id);
  const losersCount = players.length - 1;
  const iWon = challenge.winner_id === userId;

  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? iWon
            ? 'border-emerald-500/40 bg-emerald-500/10'
            : 'border-red-500/30 bg-red-500/5'
          : 'border-zinc-800 bg-zinc-950/40'
      }`}
    >
      <p className="text-center text-sm">
        {winner ? (
          <>
            <span className="text-2xl mr-1">{iWon ? '🏆' : '💀'}</span>
            <span className="font-semibold text-emerald-400">
              <UserNameTag
                username={winner.user_id === userId ? 'Tu' : winner.username}
                equipped={winner.equipped_cosmetics}
                className="text-emerald-400"
              />
            </span>
            <span className="text-zinc-300">
              {winner.user_id === userId ? ' remportes la partie !' : ' remporte la partie'}
            </span>
          </>
        ) : (
          <span className="text-zinc-400">Partie terminée</span>
        )}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {players.map((p) => {
          const isWinner = p.user_id === challenge.winner_id;
          const delta = isWinner ? challenge.wager_amount * losersCount : -challenge.wager_amount;
          return (
            <div
              key={p.id}
              className={`rounded-md px-3 py-2 text-center ${
                isWinner ? 'bg-emerald-500/10' : 'bg-zinc-800/60'
              }`}
            >
              <p className="text-xs text-zinc-400 truncate">
                <UserNameTag
                  username={displayName(p, userId)}
                  equipped={p.equipped_cosmetics}
                  linkable={false}
                />
              </p>
              <p className="text-2xl font-bold text-sky-300">
                {scoreAfter(challenge, challenge.rps_rounds.length, p.user_id)}
              </p>
              <p
                className={`text-sm font-semibold ${
                  isWinner ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {delta >= 0 ? '+' : '−'}
                {Math.abs(delta)} SP
              </p>
            </div>
          );
        })}
      </div>

      {challenge.rps_rounds.length > 0 && (
        <p className="mt-3 text-center text-lg tracking-wider">
          {challenge.rps_rounds.map((r, i) => (
            <span key={i} className="mx-1.5 inline-block" title={`Manche ${i + 1}`}>
              {players.map((p, j) => (
                <span key={p.id}>
                  {j > 0 && <span className="text-xs text-zinc-600 mx-0.5">vs</span>}
                  <span className={r.winner_id !== null && r.winner_id !== p.user_id ? 'opacity-40' : ''}>
                    {RPS_HANDS[r.moves[p.user_id]!] ?? '❔'}
                  </span>
                </span>
              ))}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
