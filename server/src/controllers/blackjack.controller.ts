import type { Request, Response } from 'express';
import * as blackjackService from '../services/blackjack.service.js';
import * as seasonService from '../services/season.service.js';

export async function getCurrent(req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();
  const result = await blackjackService.getCurrentSessionView(req.user!.id, activeSeason?.id ?? null);
  res.json(result);
}

interface JoinBody {
  betAmount?: number;
}

export async function join(req: Request<{}, {}, JoinBody>, res: Response): Promise<void> {
  const betAmount = req.body?.betAmount;
  if (!Number.isInteger(betAmount) || (betAmount as number) <= 0) {
    res.status(400).json({ error: 'La mise doit être un entier positif' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await blackjackService.joinSession(
      req.user!.id,
      betAmount as number,
      activeSeason?.id ?? null
    );
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(201).json(result);
}

export async function hit(req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await blackjackService.hit(req.user!.id, activeSeason?.id ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.json(result);
}

export async function stand(req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await blackjackService.stand(req.user!.id, activeSeason?.id ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.json(result);
}

export async function listMyHistory(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const history = await blackjackService.listMyHistory(req.user!.id, limit);
  res.json(history);
}
