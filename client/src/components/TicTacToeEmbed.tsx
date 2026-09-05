import { useEffect, useRef } from 'react';

const TIC_TAC_TOE_URL = import.meta.env.VITE_TIC_TAC_TOE_URL as string | undefined;

interface GameOverMessage {
  type: 'tictactoe:gameover';
  winnerId: number;
}

function isGameOverMessage(data: unknown): data is GameOverMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'tictactoe:gameover' &&
    Number.isInteger((data as { winnerId?: unknown }).winnerId)
  );
}

interface Props {
  /** Émis par POST /api/challenges/:id/tic-tac-toe/token (voir TicTacToeMatch.tsx) — le
   * mint est à la charge du parent, ce composant n'est qu'un pont présentation. */
  token: string;
  onGameOver: (winnerId: number) => void;
}

/**
 * Embarque le service NanoForge séparé (games/tic-tac-toe, son propre port — voir
 * CLAUDE.md section 4) dans une iframe et relaie son message de fin de partie au
 * parent via postMessage. Contrairement à FlappyBirdEmbed, PAS même-origine : on
 * compare `event.origin` à l'origine configurée du service de jeu, pas à
 * `window.location.origin`, et on transmet notre propre origine dans l'URL pour que
 * le jeu sache où répondre (voir games/tic-tac-toe/client/bridge.ts).
 */
export default function TicTacToeEmbed({ token, onGameOver }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reportedRef = useRef(false);

  useEffect(() => {
    if (!TIC_TAC_TOE_URL) return;
    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(TIC_TAC_TOE_URL).origin;
    } catch {
      return;
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin !== expectedOrigin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (isGameOverMessage(event.data) && !reportedRef.current) {
        reportedRef.current = true;
        onGameOver(event.data.winnerId);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onGameOver]);

  if (!TIC_TAC_TOE_URL) {
    return <p className="text-sm text-red-400">Jeu indisponible (VITE_TIC_TAC_TOE_URL manquant).</p>;
  }

  const src = `${TIC_TAC_TOE_URL}/?token=${encodeURIComponent(token)}&parentOrigin=${encodeURIComponent(
    window.location.origin
  )}`;

  return (
    <div
      className="mx-auto rounded-xl overflow-hidden border border-zinc-800 bg-black"
      style={{ aspectRatio: '4 / 3', maxWidth: 560 }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-same-origin"
        title="Tic-tac-toe"
        className="w-full h-full border-0"
      />
    </div>
  );
}
