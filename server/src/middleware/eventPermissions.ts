import type { NextFunction, Request, Response } from 'express';
import * as eventService from '../services/event.service.js';
import * as permissionService from '../services/permission.service.js';

// Variante de requireAdmin pour les événements : MSP ou joueur ayant reçu la
// permission 'event_organizer' (voir permission.service.ts).
export async function requireEventOrganizer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!(await permissionService.canCreateEvents(req.user!))) {
      res.status(403).json({ error: 'Accès réservé au MSP et aux organisateurs' });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }
  next();
}

// Gestion d'une session existante (:id) : MSP, ou organisateur qui l'a créée.
export async function requireSessionManager(
  req: Request<{ id?: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.user?.role === 'admin') {
    next();
    return;
  }
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide' });
    return;
  }
  try {
    const session = await eventService.getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session introuvable' });
      return;
    }
    if (!(await permissionService.canManageSession(req.user!, session))) {
      res.status(403).json({ error: 'Seul le MSP ou l’organisateur de cet événement peut faire ça' });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }
  next();
}
