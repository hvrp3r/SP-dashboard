import type { SpeedrunComGameResult } from '../types.js';

const SPEEDRUN_COM_API = 'https://www.speedrun.com/api/v1';
const MAX_RESULTS = 20;

interface SpeedrunComApiPlatform {
  name: string;
}

interface SpeedrunComApiGame {
  id: string;
  names: { international: string };
  weblink: string;
  released: number | null;
  platforms?: { data: SpeedrunComApiPlatform[] };
  assets?: {
    'cover-medium'?: { uri: string | null };
    'cover-small'?: { uri: string | null };
  };
}

interface SpeedrunComApiSearchResponse {
  data: SpeedrunComApiGame[];
}

function toResult(game: SpeedrunComApiGame): SpeedrunComGameResult {
  const platforms = game.platforms?.data?.map((p) => p.name) ?? [];
  const description =
    platforms.length > 0
      ? `${platforms.join(', ')}${game.released ? ` — sorti en ${game.released}` : ''}`
      : '';

  return {
    id: game.id,
    name: game.names.international,
    weblink: game.weblink,
    imageUrl: game.assets?.['cover-medium']?.uri ?? game.assets?.['cover-small']?.uri ?? null,
    description,
  };
}

/**
 * Recherche de jeux sur speedrun.com — utilisée par le MSP pour pré-remplir titre,
 * description, image et lien de redirection à la création d'une session Speedrun
 * (voir speedrun.controller.ts#searchGames). API publique non authentifiée
 * (https://github.com/speedruncomorg/api), embed=platforms en un seul aller-retour
 * pour construire une description synthétique (speedrun.com n'expose pas de champ
 * de description libre par jeu) — jamais de valeur imposée : purement une
 * pré-suggestion que le MSP peut ensuite éditer ou ignorer complètement.
 */
export async function searchGames(query: string): Promise<SpeedrunComGameResult[]> {
  const url = `${SPEEDRUN_COM_API}/games?name=${encodeURIComponent(query)}&max=${MAX_RESULTS}&embed=platforms`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PointsSourires/1.0 (jeu de points entre amis)' },
  });
  if (!response.ok) {
    throw new Error(`speedrun.com a répondu ${response.status}`);
  }
  const body = (await response.json()) as SpeedrunComApiSearchResponse;
  return body.data.map(toResult);
}
