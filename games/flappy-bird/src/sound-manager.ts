const VOLUME_STORAGE_KEY = 'flappybird:volume';
const DEFAULT_VOLUME = 0.5;

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    const value = raw === null ? DEFAULT_VOLUME : Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/**
 * `@nanoforge-dev/sound` (SoundLibrary) ne fournit qu'un simple bascule mute/unmute,
 * aucun contrôle de volume — on gère donc nos propres `HTMLAudioElement` pour
 * pouvoir brancher un slider de volume dessus. `play()` clone l'élément à chaque
 * appel pour permettre des sons qui se chevauchent (ex: sauts rapprochés).
 */
export class SoundManager {
  private sounds = new Map<string, HTMLAudioElement>();
  private volume = readStoredVolume();

  load(key: string, url: string): void {
    const audio = new Audio(url);
    audio.volume = this.volume;
    this.sounds.set(key, audio);
  }

  play(key: string): void {
    const audio = this.sounds.get(key);
    if (!audio) return;
    const instance = audio.cloneNode(true) as HTMLAudioElement;
    instance.volume = this.volume;
    instance.play().catch(() => {
      // Lecture bloquée (politique autoplay) — pas grave, on ignore silencieusement.
    });
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    for (const audio of this.sounds.values()) audio.volume = this.volume;
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(this.volume));
    } catch {
      // Stockage indisponible (mode privé, etc.) — pas grave, le volume reste actif pour cette session.
    }
  }

  getVolume(): number {
    return this.volume;
  }
}
