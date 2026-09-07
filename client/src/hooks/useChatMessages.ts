import { useCallback, useEffect, useRef, useState } from 'react';
import * as chatApi from '../api/chat.js';
import type { ChatMessage, ChatRoom } from '../types.js';

// 1s — aligné sur le sondage le plus rapide déjà utilisé dans l'app (Crash en vol,
// voir Crash.tsx) : un chat doit se sentir proche du temps réel, 3s donnait
// l'impression d'un décalage perceptible entre joueurs qui discutent en direct.
const POLL_INTERVAL_MS = 1000;
// Doit correspondre à HISTORY_LIMIT dans server/src/services/chat.service.ts —
// sert à deviner s'il reste de l'historique plus ancien à charger (un lot renvoyé
// incomplet = plus rien avant), sans requête de comptage séparée.
const HISTORY_PAGE_SIZE = 50;

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev;
  const existingIds = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !existingIds.has(m.id));
  return fresh.length > 0 ? [...prev, ...fresh] : prev;
}

function prependMessages(prev: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  if (older.length === 0) return prev;
  const existingIds = new Set(prev.map((m) => m.id));
  const fresh = older.filter((m) => !existingIds.has(m.id));
  return fresh.length > 0 ? [...fresh, ...prev] : prev;
}

/** Historique + sondage incrémental d'un salon de chat, ré-initialisé à chaque
 * changement de room/roomKey (voir chat.service.ts côté serveur). `incomingCount`
 * ne compte que les messages arrivés par sondage incrémental (pas le lot
 * d'historique initial, ni ceux qu'on vient d'envoyer soi-même) — sert de base au
 * badge "nouveaux messages" quand le panneau est réduit (voir ChatDock.tsx).
 * `hasMore`/`loadOlder` permettent de remonter au-delà du lot initial (limité à
 * HISTORY_PAGE_SIZE messages) via un bouton "charger les messages précédents". */
export function useChatMessages(room: ChatRoom, roomKey: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [incomingCount, setIncomingCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    lastIdRef.current = 0;
    setMessages([]);
    setIncomingCount(0);
    setHasMore(false);

    async function poll() {
      try {
        const isInitialBatch = lastIdRef.current === 0;
        const list = isInitialBatch
          ? await chatApi.listMessages(room, roomKey)
          : await chatApi.listMessages(room, roomKey, lastIdRef.current);
        if (cancelled) return;
        if (isInitialBatch) {
          setHasMore(list.length >= HISTORY_PAGE_SIZE);
        }
        setMessages((prev) => mergeMessages(prev, list));
        if (!isInitialBatch && list.length > 0) {
          setIncomingCount((c) => c + list.length);
        }
        if (list.length > 0) lastIdRef.current = list[list.length - 1]!.id;
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur inconnue');
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [room, roomKey]);

  const send = useCallback(
    async (body: string) => {
      const message = await chatApi.sendMessage(room, body, roomKey);
      setMessages((prev) => mergeMessages(prev, [message]));
      lastIdRef.current = message.id;
    },
    [room, roomKey]
  );

  const loadOlder = useCallback(async () => {
    if (messages.length === 0 || loadingMore) return;
    const oldestId = messages[0]!.id;
    setLoadingMore(true);
    try {
      const older = await chatApi.listMessagesBefore(room, roomKey, oldestId);
      setMessages((prev) => prependMessages(prev, older));
      setHasMore(older.length >= HISTORY_PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoadingMore(false);
    }
  }, [room, roomKey, messages, loadingMore]);

  return { messages, error, send, incomingCount, hasMore, loadingMore, loadOlder };
}
