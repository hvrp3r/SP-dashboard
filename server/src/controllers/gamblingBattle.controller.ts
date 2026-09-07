import type { Request, Response } from 'express';
import * as battleService from '../services/gamblingBattle.service.js';
import * as seasonService from '../services/season.service.js';

function handleError(err: unknown, res: Response): void {
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
}

export async function listBattles(req: Request, res: Response): Promise<void> {
  const battles = await battleService.listOpenBattles();
  res.json(battles);
}

export async function listHistory(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
  const history = await battleService.listHistory(limit);
  res.json(history);
}

export async function getBattle(req: Request<{ id: string }>, res: Response): Promise<void> {
  const battleId = Number(req.params.id);
  if (!Number.isInteger(battleId)) {
    res.status(400).json({ error: 'Identifiant de bataille invalide' });
    return;
  }
  try {
    const result = await battleService.getBattleView(battleId, req.user!.id);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
}

interface CreateBattleBody {
  crateIds?: number[];
  maxPlayers?: number;
}

export async function createBattle(
  req: Request<{}, {}, CreateBattleBody>,
  res: Response
): Promise<void> {
  const crateIds = req.body?.crateIds;
  const maxPlayers = req.body?.maxPlayers;
  if (!Array.isArray(crateIds) || crateIds.length === 0 || !crateIds.every((id) => Number.isInteger(id))) {
    res.status(400).json({ error: 'Sélectionne au moins une caisse' });
    return;
  }
  if (!Number.isInteger(maxPlayers)) {
    res.status(400).json({ error: 'Nombre de joueurs invalide' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();
  try {
    const result = await battleService.createBattle({
      userId: req.user!.id,
      seasonId: activeSeason?.id ?? null,
      crateIds,
      maxPlayers: maxPlayers as number,
    });
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
}

export async function joinBattle(req: Request<{ id: string }>, res: Response): Promise<void> {
  const battleId = Number(req.params.id);
  if (!Number.isInteger(battleId)) {
    res.status(400).json({ error: 'Identifiant de bataille invalide' });
    return;
  }
  const activeSeason = await seasonService.getActiveSeason();
  try {
    const result = await battleService.joinBattle(req.user!.id, battleId, activeSeason?.id ?? null);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
}

export async function cancelBattle(req: Request<{ id: string }>, res: Response): Promise<void> {
  const battleId = Number(req.params.id);
  if (!Number.isInteger(battleId)) {
    res.status(400).json({ error: 'Identifiant de bataille invalide' });
    return;
  }
  try {
    await battleService.cancelBattle(req.user!.id, battleId, req.user!.role === 'admin');
    res.status(204).end();
  } catch (err) {
    handleError(err, res);
  }
}
