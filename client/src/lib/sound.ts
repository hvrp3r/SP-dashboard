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
