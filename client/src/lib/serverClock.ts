import { apiClient } from '../api/client.js';

interface HealthResponse {
  status: string;
  now: number;
}

const SAMPLE_COUNT = 5;

let offsetMs = 0;
let synced = false;

/**
 * Estime `offsetMs` tel que `Date.now() + offsetMs` approxime l'heure serveur au
 * moment de l'appel — une horloge locale qui peut dériver de plusieurs centaines
 * de ms par rapport au serveur sinon, ce qui décale visuellement le multiplicateur
 * du crash (calculé côté client à partir de `started_at` + `Date.now()`) par rapport
 * à ce que le serveur considère comme l'instant réel.
 *
 * Méthode NTP simplifiée à un seul timestamp serveur (le traitement de /api/health
 * est quasi instantané, donc t_serveur est confondu avec le milieu de l'aller-retour) :
 * offset = t_serveur - (t0_envoi + t1_réception) / 2. Répété plusieurs fois, on ne
 * garde que l'essai au round-trip le plus court, le moins sujet au jitter réseau.
 */
export async function syncServerClock(): Promise<number> {
  let best: { offset: number; roundTrip: number } | null = null;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t0 = Date.now();
    let serverNow: number;
    try {
      const res = await apiClient.get<HealthResponse>('/api/health', { skipAuth: true });
      serverNow = res.now;
    } catch {
      continue;
    }
    const t1 = Date.now();
    const roundTrip = t1 - t0;
    const offset = serverNow - (t0 + t1) / 2;
    if (!best || roundTrip < best.roundTrip) {
      best = { offset, roundTrip };
    }
  }

  if (best) {
    offsetMs = best.offset;
    synced = true;
  }
  return offsetMs;
}

/** Meilleure estimation de l'heure serveur actuelle, à utiliser à la place de `Date.now()`
 * partout où l'on compare à un timestamp renvoyé par le serveur (`started_at`, `crashed_at`…). */
export function getServerNow(): number {
  return Date.now() + offsetMs;
}

export function isClockSynced(): boolean {
  return synced;
}
