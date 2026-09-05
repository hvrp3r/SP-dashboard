import jwt from 'jsonwebtoken';
import type {
  AccessTokenPayload,
  FlappyBirdAttemptTokenPayload,
  RefreshTokenPayload,
  UserRow,
} from '../types.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
// Assez large pour couvrir une session de jeu normale (plusieurs parties d'affilée),
// sans traîner indéfiniment un token qu'on pourrait réutiliser bien plus tard.
const FLAPPYBIRD_ATTEMPT_TOKEN_TTL = '30m';

export function signAccessToken(user: Pick<UserRow, 'id' | 'username' | 'role'>): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role } satisfies AccessTokenPayload,
    process.env.JWT_SECRET as string,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

export function signRefreshToken(user: Pick<UserRow, 'id'>): string {
  return jwt.sign(
    { sub: user.id } satisfies RefreshTokenPayload,
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_SECRET as string) as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET as string) as unknown as RefreshTokenPayload;
}

export const REFRESH_COOKIE_NAME = 'sp_refresh_token';
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Émet un maillon de la chaîne de score Flappy Bird (voir FlappyBirdAttemptTokenPayload) :
 * `score: 0` au début d'une partie, `score: n+1` à chaque point re-signé par
 * `reportPoint`. `iat` est toujours réémis "maintenant" par `jwt.sign`, ce qui sert
 * d'horodatage du DERNIER point compté sans avoir besoin d'un champ dédié.
 */
export function signFlappyBirdAttemptToken(sessionId: number, userId: number, score: number): string {
  return jwt.sign(
    { sessionId, userId, score } satisfies Omit<FlappyBirdAttemptTokenPayload, 'iat'>,
    process.env.JWT_SECRET as string,
    { expiresIn: FLAPPYBIRD_ATTEMPT_TOKEN_TTL }
  );
}

/** Renvoie `null` si le token est absent, expiré, falsifié, ou ne correspond pas à cette session/cet utilisateur. */
export function verifyFlappyBirdAttemptToken(
  token: unknown,
  sessionId: number,
  userId: number
): FlappyBirdAttemptTokenPayload | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as unknown as FlappyBirdAttemptTokenPayload;
    if (payload.sessionId !== sessionId || payload.userId !== userId) return null;
    return payload;
  } catch {
    return null;
  }
}
