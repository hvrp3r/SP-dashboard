import jwt from 'jsonwebtoken';
import type { AccessTokenPayload, RefreshTokenPayload, UserRow } from '../types.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

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
