import { useEffect, useRef } from 'react';

interface FlappyBirdGameOverMessage {
  type: 'flappybird:gameover';
  score: number;
}

function isGameOverMessage(data: unknown): data is FlappyBirdGameOverMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'flappybird:gameover' &&
    Number.isInteger((data as { score?: unknown }).score)
  );
}

interface Props {
  onGameOver: (score: number) => void;
}

/**
 * Embarque le bundle NanoForge (servi même-origine sous /games/flappy-bird/) dans une
 * iframe et relaie son score de fin de partie au parent via postMessage. Composant
 * purement présentation + pont — aucun appel API direct, réutilisable tel quel pour
 * un futur jeu NanoForge (même contrat postMessage). Le jeu gère lui-même le
 * redémarrage (clic après game over) — pas besoin de remonter l'iframe.
 */
export default function FlappyBirdEmbed({ onGameOver }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isGameOverMessage(event.data)) return;
      onGameOver(event.data.score);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onGameOver]);

  return (
    <div
      className="mx-auto rounded-xl overflow-hidden border border-zinc-800 bg-black"
      style={{ aspectRatio: '3 / 4', maxWidth: 420 }}
    >
      <iframe
        ref={iframeRef}
        src="/games/flappy-bird/index.html"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen"
        allowFullScreen
        title="Flappy Bird"
        className="w-full h-full border-0"
      />
    </div>
  );
}
