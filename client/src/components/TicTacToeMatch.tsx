import { useEffect, useState } from 'react';
import TicTacToeEmbed from './TicTacToeEmbed.jsx';
import * as challengesApi from '../api/challenges.js';

interface Props {
  challengeId: number;
  onGameOver: (winnerId: number) => void;
}

/**
 * Mint le token de partie (POST /:id/tic-tac-toe/token) une fois au montage puis
 * délègue tout l'affichage/la connexion au jeu à TicTacToeEmbed (pur pont
 * présentation) — orchestration séparée de la présentation, même découpage que
 * FlappyBirdSessionDetail/FlappyBirdEmbed.
 */
export default function TicTacToeMatch({ challengeId, onGameOver }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setToken(null);
    setError(null);
    challengesApi
      .mintTicTacToeToken(challengeId)
      .then((data) => {
        if (!cancelled) setToken(data.token);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur inconnue');
      });
    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!token) return <p className="text-sm text-zinc-500">Chargement de la partie…</p>;

  return <TicTacToeEmbed token={token} onGameOver={onGameOver} />;
}
