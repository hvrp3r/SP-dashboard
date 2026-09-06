import type { Request, Response } from 'express';
import * as towerService from '../services/tower.service.js';
import * as seasonService from '../services/season.service.js';

export async function getCurrent(req: Request, res: Response): Promise<void> {
  const result = await towerService.getCurrentGameView(req.user!.id);
  res.json(result);
}

export async function getDifficulties(req: Request, res: Response): Promise<void> {
  res.json(towerService.listDifficulties());
}

interface StartBody {
  difficulty?: string;
  betAmount?: number;
}

export async function start(req: Request<{}, {}, StartBody>, res: Response): Promise<void> {
  const { difficulty, betAmount } = req.body ?? {};
  if (!Number.isInteger(betAmount) || (betAmount as number) <= 0) {
    res.status(400).json({ error: 'La mise doit être un entier positif' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await towerService.startGame(
      req.user!.id,
      difficulty as 'easy' | 'medium' | 'hard',
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

interface PickBody {
  cell?: number;
}

export async function pick(req: Request<{}, {}, PickBody>, res: Response): Promise<void> {
  const cell = req.body?.cell;

  let result;
  try {
    result = await towerService.pickCell(req.user!.id, cell as number);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.json(result);
}

export async function cashOut(req: Request, res: Response): Promise<void> {
  let result;
  try {
    result = await towerService.cashOut(req.user!.id);
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
  const history = await towerService.listMyHistory(req.user!.id, limit);
  res.json(history);
}
