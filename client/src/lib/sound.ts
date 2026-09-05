import type { RewardRarity } from './gamblingLabels.js';

const VOLUME_STORAGE_KEY = 'sp_gambling_sfx_volume';

function readStoredVolume(): number {
  if (typeof window === 'undefined') return 0.6;
  const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
  const parsed = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.6;
}

let volume = readStoredVolume();

export function getVolume(): number {
  return volume;
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  }
}

let ctx: AudioContext | null = null;

/** Contexte audio créé paresseusement, à débloquer depuis un vrai geste utilisateur
 * (les navigateurs bloquent l'audio tant qu'aucun clic n'a eu lieu). */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** À appeler de façon synchrone dans un handler de clic pour débloquer l'audio. */
export function unlockAudio(): void {
  getContext();
}

function tone(freq: number, startTime: number, duration: number, type: OscillatorType, peak: number): void {
  if (volume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak * volume, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/** Petit "tic" joué à chaque item qui passe sous le marqueur pendant le défilement. */
export function playTick(): void {
  const audio = getContext();
  if (!audio) return;
  tone(900, audio.currentTime, 0.045, 'square', 0.05);
}

/** Jingle de révélation, plus riche selon la rareté du gain obtenu. */
export function playReveal(rarity: RewardRarity): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  if (rarity === 'legendary') {
    tone(523.25, now, 0.18, 'triangle', 0.13);
    tone(659.25, now + 0.09, 0.18, 'triangle', 0.13);
    tone(783.99, now + 0.18, 0.32, 'triangle', 0.15);
  } else if (rarity === 'rare') {
    tone(587.33, now, 0.15, 'triangle', 0.11);
    tone(880, now + 0.1, 0.24, 'triangle', 0.13);
  } else {
    tone(660, now, 0.18, 'sine', 0.09);
  }
}

/** Petit "clic" sec joué pour une carte distribuée — `delaySeconds` permet de
 * synchroniser plusieurs tics avec l'animation visuelle en cascade (dealCard). */
export function playCardDeal(delaySeconds = 0): void {
  const audio = getContext();
  if (!audio) return;
  tone(1100, audio.currentTime + delaySeconds, 0.05, 'square', 0.045);
}

/** Cliquetis de jeton, à l'inscription d'un joueur (soi-même ou un autre) à la table. */
export function playChip(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(420, now, 0.06, 'triangle', 0.08);
  tone(620, now + 0.04, 0.08, 'triangle', 0.07);
}

/** Petit carillon discret quand c'est (enfin) le tour du joueur local. */
export function playYourTurn(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(740, now, 0.1, 'sine', 0.08);
  tone(988, now + 0.08, 0.16, 'sine', 0.09);
}

export function playWin(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(659.25, now, 0.14, 'triangle', 0.11);
  tone(880, now + 0.09, 0.22, 'triangle', 0.13);
}

/** Fanfare plus riche pour un blackjack naturel. */
export function playBlackjackWin(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(523.25, now, 0.15, 'triangle', 0.12);
  tone(659.25, now + 0.09, 0.15, 'triangle', 0.12);
  tone(783.99, now + 0.18, 0.15, 'triangle', 0.13);
  tone(1046.5, now + 0.27, 0.32, 'triangle', 0.15);
}

export function playLose(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(311, now, 0.16, 'sawtooth', 0.06);
  tone(233, now + 0.12, 0.28, 'sawtooth', 0.07);
}

export function playPush(): void {
  const audio = getContext();
  if (!audio) return;
  tone(440, audio.currentTime, 0.16, 'sine', 0.07);
}

/** Glissando ascendant bref au décollage (passage betting -> running du Crash). */
export function playLiftoff(): void {
  if (volume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(520, now + 0.45);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06 * volume, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.47);
}

/** Explosion sourde (thump grave + bruit blanc filtré en decay) au crash. */
export function playCrashExplosion(): void {
  if (volume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;

  tone(90, now, 0.35, 'sawtooth', 0.16);
  tone(55, now + 0.03, 0.4, 'sine', 0.14);

  const bufferSize = Math.floor(audio.sampleRate * 0.3);
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, now);
  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(0.18 * volume, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audio.destination);
  noise.start(now);
  noise.stop(now + 0.3);
}

/** Chuintement ascendant au lancer de la pièce (pile ou face). */
export function playCoinToss(): void {
  if (volume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(260, now);
  osc.frequency.exponentialRampToValueAtTime(920, now + 0.22);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.09 * volume, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}

/** Petit "clic" métallique à un rebond de la pièce — `delaySeconds` synchronise avec
 * les rebonds de l'animation coinBounceFlip, `strength` atténue les rebonds suivants. */
export function playCoinBounce(delaySeconds: number, strength: number): void {
  const audio = getContext();
  if (!audio) return;
  const startTime = audio.currentTime + delaySeconds;
  tone(1500, startTime, 0.08, 'triangle', 0.1 * strength);
  tone(680, startTime, 0.12, 'sine', 0.06 * strength);
}

/** Petit carillon neutre à la révélation du résultat du pile ou face. */
export function playCoinReveal(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(784, now, 0.12, 'triangle', 0.09);
  tone(1174.66, now + 0.08, 0.24, 'triangle', 0.11);
}

/** "Cha-ching" de caisse enregistreuse à un retrait Crash réussi. */
export function playCashRegister(): void {
  const audio = getContext();
  if (!audio) return;
  const now = audio.currentTime;
  tone(1046.5, now, 0.09, 'square', 0.06);
  tone(1318.5, now + 0.06, 0.09, 'square', 0.06);
  tone(1568, now + 0.12, 0.28, 'triangle', 0.12);
}
