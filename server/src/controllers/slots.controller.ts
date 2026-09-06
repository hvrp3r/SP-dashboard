import type { Request, Response } from 'express';
import * as slotsService from '../services/slots.service.js';
import * as seasonService from '../services/season.service.js';

export async function getStatus(req: Request, res: Response): Promise<void> {
  const result = await slotsService.getStatus(req.user!.id);
  res.json(result);
}

export async function getPaytable(req: Request, res: Response): Promise<void> {
  res.json(slotsService.listPaytable());
}

interface SpinBody {
  betAmount?: number;
}

export async function spin(req: Request<{}, {}, SpinBody>, res: Response): Promise<void> {
  const { betAmount } = req.body ?? {};
  if (!Number.isInteger(betAmount) || (betAmount as number) <= 0) {
    res.status(400).json({ error: 'La mise doit être un entier positif' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await slotsService.spin(req.user!.id, betAmount as number, activeSeason?.id ?? null);
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
  const history = await slotsService.listHistory(limit, mine ? req.user!.id : null);
  res.json(history);
}
