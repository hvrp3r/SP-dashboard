import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ChatRoom } from '../types.js';

export interface ChatGameRoom {
  room: ChatRoom;
  roomKey: string;
  label: string;
  icon: string;
}

interface ChatGameRoomContextValue {
  gameRoom: ChatGameRoom | null;
  setGameRoom: (room: ChatGameRoom | null) => void;
}

const ChatGameRoomContext = createContext<ChatGameRoomContextValue | null>(null);

export function ChatGameRoomProvider({ children }: { children: ReactNode }) {
  const [gameRoom, setGameRoom] = useState<ChatGameRoom | null>(null);
  return (
    <ChatGameRoomContext.Provider value={{ gameRoom, setGameRoom }}>
      {children}
    </ChatGameRoomContext.Provider>
  );
}

function useChatGameRoomContext(): ChatGameRoomContextValue {
  const ctx = useContext(ChatGameRoomContext);
  if (!ctx) throw new Error('useChatGameRoomContext doit être utilisé dans un ChatGameRoomProvider');
  return ctx;
}

/** Salon de jeu actuellement annoncé (page visitée), consommé par ChatDock. */
export function useChatGameRoom(): ChatGameRoom | null {
  return useChatGameRoomContext().gameRoom;
}

/**
 * À appeler depuis une page de jeu (Crash, Tower, Blackjack, caisse, session de
 * événement…) pour annoncer son salon de discussion au ChatDock global — celui-ci
 * est monté une seule fois dans App et n'a sinon aucun moyen de savoir sur quelle
 * page de jeu on se trouve. Passer `null` tant que la page n'a rien à annoncer
 * (ex : session d'événement pas encore chargée). Désinscrit automatiquement au
 * démontage (changement de page).
 */
export function useAnnounceChatRoom(room: ChatGameRoom | null): void {
  const { setGameRoom } = useChatGameRoomContext();
  useEffect(() => {
    setGameRoom(room);
    return () => setGameRoom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.room, room?.roomKey, room?.label, room?.icon]);
}
