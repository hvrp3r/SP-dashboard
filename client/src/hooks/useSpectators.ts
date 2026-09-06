import { useEffect, useState } from 'react';
import * as gamblingApi from '../api/gambling.js';
import type { GamblingSpectatorEntry, GamblingSpectatorRoom } from '../types.js';

const HEARTBEAT_INTERVAL_MS = 4000;

/** Envoie un heartbeat de présence en boucle tant que le composant appelant reste
 * monté, et retourne la liste des spectateurs actuellement présents sur la room
 * (rafraîchie à chaque heartbeat). Voir gambling_spectators (migration 049). */
export function useSpectators(room: GamblingSpectatorRoom, roomKey?: string): GamblingSpectatorEntry[] {
  const [spectators, setSpectators] = useState<GamblingSpectatorEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      gamblingApi
        .heartbeatSpectator(room, roomKey)
        .then(() => gamblingApi.getSpectators(room, roomKey))
        .then((list) => {
          if (!cancelled) setSpectators(list);
        })
        .catch(() => {});
    };

    tick();
    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [room, roomKey]);

  return spectators;
}
