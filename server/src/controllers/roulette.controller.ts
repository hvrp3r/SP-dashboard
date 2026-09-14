import type { Request, Response } from 'express';
import * as rouletteService from '../services/roulette.service.js';
import * as seasonService from '../services/season.service.js';

export async function getPayouts(req: Request, res: Response): Promise<void> {
  res.json(rouletteService.listPayouts());
}

interface SpinBody {
  bets?: unknown;
}

export async function spin(req: Request<{}, {}, SpinBody>, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await rouletteService.spin(req.user!.id, req.body?.bets, activeSeason?.id ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(201).json(result);
}

export async function listHistory(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const mine = req.query.mine === 'true';
  const history = await rouletteService.listHistory(limit, mine ? req.user!.id : null);
  res.json(history);
}
