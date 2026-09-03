import type { Request, Response } from 'express';
import * as userService from '../services/user.service.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_MS,
} from '../utils/jwt.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,50}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterBody {
  username?: string;
  email?: string;
  password?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: '/api/auth',
  });
}

export async function register(req: Request<{}, {}, RegisterBody>, res: Response): Promise<void> {
  const { username, email, password } = req.body ?? {};

  if (!username || !email || !password) {
    res.status(400).json({ error: 'Username, email et mot de passe requis' });
    return;
  }
  if (!USERNAME_REGEX.test(username)) {
    res.status(400).json({
      error: 'Username invalide (3-50 caractères alphanumériques ou underscore)',
    });
    return;
  }
  if (!EMAIL_REGEX.test(email)) {
    res.status(400).json({ error: 'Email invalide' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    return;
  }

  if (await userService.findByEmail(email)) {
    res.status(409).json({ error: 'Cet email est déjà utilisé' });
    return;
  }
  if (await userService.findByUsername(username)) {
    res.status(409).json({ error: 'Ce username est déjà pris' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await userService.createUser({ username, email, passwordHash });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  setRefreshCookie(res, refreshToken);

  res.status(201).json({ user, accessToken });
}

export async function login(req: Request<{}, {}, LoginBody>, res: Response): Promise<void> {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: 'Email et mot de passe requis' });
    return;
  }

  const user = await userService.findByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  setRefreshCookie(res, refreshToken);

  const { password_hash, ...publicUser } = user;
  res.json({ user: publicUser, accessToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Refresh token manquant' });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    res.status(401).json({ error: 'Refresh token invalide ou expiré' });
    return;
  }

  const user = await userService.findById(payload.sub);
  if (!user) {
    res.status(401).json({ error: 'Utilisateur introuvable' });
    return;
  }

  const accessToken = signAccessToken(user);
  res.json({ accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.status(204).send();
}
