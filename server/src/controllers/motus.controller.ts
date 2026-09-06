import type { Request, Response } from 'express';
import * as motusService from '../services/motus.service.js';
import * as seasonService from '../services/season.service.js';
import * as notificationService from '../services/notification.service.js';

export async function getToday(req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();
  const view = await motusService.getTodayView(req.user!.id, activeSeason?.id ?? null);
  res.json(view);
}

interface GuessBody {
  guess?: string;
}

export async function submitGuess(req: Request<{}, {}, GuessBody>, res: Response): Promise<void> {
  const guess = req.body?.guess;
  if (typeof guess !== 'string' || guess.trim().length === 0) {
    res.status(400).json({ error: 'Proposition manquante' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let view;
  try {
    view = await motusService.submitGuess(req.user!.id, activeSeason?.id ?? null, guess);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  if (view.status === 'won') {
    await notificationService.createNotification({
      userId: req.user!.id,
      type: 'sp_gained',
      message:
        view.rewardSp > 0
          ? `Tu as trouvé le mot du jour au Motus — +${view.rewardSp} SP`
          : 'Tu as trouvé le mot du jour au Motus',
      link: '/motus',
    });
  }

  res.status(201).json(view);
}

export async function listQueue(_req: Request, res: Response): Promise<void> {
  const pending = await motusService.listPendingQueue();
  res.json(pending);
}

interface AddQueueWordBody {
  word?: string;
}

export async function addQueueWord(
  req: Request<{}, {}, AddQueueWordBody>,
  res: Response
): Promise<void> {
  const word = req.body?.word;
  if (typeof word !== 'string' || word.trim().length === 0) {
    res.status(400).json({ error: 'Mot manquant' });
    return;
  }

  let entry;
  try {
    entry = await motusService.addQueueWord(word, req.user!.id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  res.status(201).json(entry);
}

export async function removeQueueWord(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const removed = await motusService.removeQueueWord(id);
  if (!removed) {
    res.status(404).json({ error: 'Mot introuvable ou déjà utilisé' });
    return;
  }

  res.status(204).end();
}

interface ReorderQueueWordBody {
  direction?: string;
}

export async function reorderQueueWord(
  req: Request<{ id: string }, {}, ReorderQueueWordBody>,
  res: Response
): Promise<void> {
  const id = Number(req.params.id);
  const direction = req.body?.direction;
  if (!Number.isInteger(id) || (direction !== 'up' && direction !== 'down')) {
    res.status(400).json({ error: 'Requête invalide' });
    return;
  }

  let queue;
  try {
    queue = await motusService.reorderQueueWord(id, direction);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  res.json(queue);
}

export async function listHistory(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const history = await motusService.listHistory(limit);
  res.json(history);
}

export async function listAttempts(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const attempts = await motusService.listRecentAttempts(limit);
  res.json(attempts);
}

export async function getTodayAdmin(_req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();
  const view = await motusService.getTodayAdminView(activeSeason?.id ?? null);
  res.json(view);
}

interface OverrideTodayBody {
  word?: string;
}

export async function overrideToday(
  req: Request<{}, {}, OverrideTodayBody>,
  res: Response
): Promise<void> {
  const word = req.body?.word;
  if (typeof word !== 'string' || word.trim().length === 0) {
    res.status(400).json({ error: 'Mot manquant' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let daily;
  try {
    daily = await motusService.overrideTodayWord(word, activeSeason?.id ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  // Une réussite implique forcément attemptCount === 0 (précondition de overrideTodayWord).
  res.json({ wordDate: daily.word_date, word: daily.word, source: daily.source, attemptCount: 0 });
}
