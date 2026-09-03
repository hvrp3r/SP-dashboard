import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { applyDailyLoginBonus } from '../services/loginBonus.service.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentification requise' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
    return;
  }

  try {
    await applyDailyLoginBonus(req.user.id);
  } catch (err) {
    // Le bonus quotidien est un effet secondaire : une erreur ici ne doit pas
    // bloquer le reste de la requête authentifiée.
    console.error('Erreur bonus de connexion quotidien:', err);
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Accès réservé au MSP' });
    return;
  }
  next();
}
