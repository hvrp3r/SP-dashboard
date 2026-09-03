import type { Request, Response } from 'express';
import * as notificationService from '../services/notification.service.js';

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
  const unreadOnly = req.query.unreadOnly === 'true';

  const notifications = await notificationService.listNotifications(req.user!.id, {
    limit,
    unreadOnly,
  });
  res.json(notifications);
}

export async function unreadCount(req: Request, res: Response): Promise<void> {
  const count = await notificationService.countUnread(req.user!.id);
  res.json({ count });
}

export async function markRead(req: Request<{ id: string }>, res: Response): Promise<void> {
  const notificationId = Number(req.params.id);
  if (!Number.isInteger(notificationId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  await notificationService.markRead(notificationId, req.user!.id);
  res.status(204).send();
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  await notificationService.markAllRead(req.user!.id);
  res.status(204).send();
}
