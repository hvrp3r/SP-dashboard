import type { Request, Response } from 'express';
import * as gamblingService from '../services/gambling.service.js';
import * as configService from '../services/config.service.js';
import * as seasonService from '../services/season.service.js';
import type { GamblingCrateRewardRow, GamblingCrateRewardView, GamblingRewardType } from '../types.js';

const VALID_REWARD_TYPES: GamblingRewardType[] = ['sp', 'custom'];

function withPercent(rewards: GamblingCrateRewardRow[]): GamblingCrateRewardView[] {
  const totalWeight = rewards.reduce((sum, r) => sum + r.weight, 0);
  return rewards.map((r) => ({
    ...r,
    weight_percent: totalWeight > 0 ? Math.round((r.weight / totalWeight) * 1000) / 10 : 0,
  }));
}

export async function listCrates(req: Request, res: Response): Promise<void> {
  const includeInactive = req.user?.role === 'admin' && req.query.includeInactive === 'true';
  const crates = await gamblingService.listCrates(includeInactive, req.user!.id);
  res.json(crates);
}

export async function getCrate(req: Request<{ id: string }>, res: Response): Promise<void> {
  const crateId = Number(req.params.id);
  if (!Number.isInteger(crateId)) {
    res.status(400).json({ error: 'Identifiant de caisse invalide' });
    return;
  }
  const crate = await gamblingService.getCrateById(crateId);
  if (!crate) {
    res.status(404).json({ error: 'Caisse introuvable' });
    return;
  }
  const rewards = await gamblingService.listRewards(crateId);
  const myOpenCount = await gamblingService.getUserOpenCount(req.user!.id, crateId);
  res.json({ ...crate, rewards: withPercent(rewards), myOpenCount });
}

interface CreateCrateBody {
  name?: string;
  description?: string;
  imageUrl?: string;
  costSp?: number;
  maxOpensPerPlayer?: number | null;
}

export async function createCrate(
  req: Request<{}, {}, CreateCrateBody>,
  res: Response
): Promise<void> {
  const name = req.body?.name?.trim();
  const description = req.body?.description?.trim();
  const imageUrl = req.body?.imageUrl?.trim();
  const costSp = req.body?.costSp;
  const maxOpensPerPlayer = req.body?.maxOpensPerPlayer;

  if (!name) {
    res.status(400).json({ error: 'Le nom est requis' });
    return;
  }
  if (!Number.isInteger(costSp) || (costSp as number) <= 0) {
    res.status(400).json({ error: 'Le coût doit être un entier positif' });
    return;
  }
  if (
    maxOpensPerPlayer !== undefined &&
    maxOpensPerPlayer !== null &&
    (!Number.isInteger(maxOpensPerPlayer) || maxOpensPerPlayer <= 0)
  ) {
    res
      .status(400)
      .json({ error: "La limite d'ouvertures par joueur doit être un entier positif" });
    return;
  }

  const crate = await gamblingService.createCrate({
    name,
    description: description || null,
    imageUrl: imageUrl || null,
    costSp: costSp as number,
    maxOpensPerPlayer: maxOpensPerPlayer ?? null,
    createdBy: req.user!.id,
  });
  res.status(201).json(crate);
}

interface UpdateCrateBody {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  costSp?: number;
  maxOpensPerPlayer?: number | null;
  isActive?: boolean;
}

export async function updateCrate(
  req: Request<{ id: string }, {}, UpdateCrateBody>,
  res: Response
): Promise<void> {
  const crateId = Number(req.params.id);
  if (!Number.isInteger(crateId)) {
    res.status(400).json({ error: 'Identifiant de caisse invalide' });
    return;
  }
  const body = req.body ?? {};
  if (body.costSp !== undefined && (!Number.isInteger(body.costSp) || body.costSp <= 0)) {
    res.status(400).json({ error: 'Le coût doit être un entier positif' });
    return;
  }
  if (
    body.maxOpensPerPlayer !== undefined &&
    body.maxOpensPerPlayer !== null &&
    (!Number.isInteger(body.maxOpensPerPlayer) || body.maxOpensPerPlayer <= 0)
  ) {
    res
      .status(400)
      .json({ error: "La limite d'ouvertures par joueur doit être un entier positif" });
    return;
  }

  const updated = await gamblingService.updateCrate(crateId, {
    name: body.name?.trim(),
    description: body.description !== undefined ? body.description?.trim() || null : undefined,
    imageUrl: body.imageUrl !== undefined ? body.imageUrl?.trim() || null : undefined,
    costSp: body.costSp,
    maxOpensPerPlayer: body.maxOpensPerPlayer,
    isActive: body.isActive,
  });
  if (!updated) {
    res.status(404).json({ error: 'Caisse introuvable' });
    return;
  }
  res.json(updated);
}

export async function removeCrate(req: Request<{ id: string }>, res: Response): Promise<void> {
  const crateId = Number(req.params.id);
  if (!Number.isInteger(crateId)) {
    res.status(400).json({ error: 'Identifiant de caisse invalide' });
    return;
  }

  const existing = await gamblingService.getCrateById(crateId);
  if (!existing) {
    res.status(404).json({ error: 'Caisse introuvable' });
    return;
  }

  try {
    await gamblingService.removeCrate(crateId);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(204).end();
}

interface AddRewardBody {
  type?: GamblingRewardType;
  title?: string;
  imageUrl?: string;
  spAmount?: number;
  weight?: number;
}

export async function addReward(
  req: Request<{ id: string }, {}, AddRewardBody>,
  res: Response
): Promise<void> {
  const crateId = Number(req.params.id);
  if (!Number.isInteger(crateId)) {
    res.status(400).json({ error: 'Identifiant de caisse invalide' });
    return;
  }
  const crate = await gamblingService.getCrateById(crateId);
  if (!crate) {
    res.status(404).json({ error: 'Caisse introuvable' });
    return;
  }

  const type = req.body?.type;
  const title = req.body?.title?.trim();
  const imageUrl = req.body?.imageUrl?.trim();
  const spAmount = req.body?.spAmount;
  const weight = req.body?.weight;

  if (!type || !VALID_REWARD_TYPES.includes(type)) {
    res.status(400).json({ error: 'Type de gain invalide' });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'Le titre est requis' });
    return;
  }
  if (!Number.isInteger(weight) || (weight as number) <= 0) {
    res.status(400).json({ error: 'Le poids doit être un entier positif' });
    return;
  }
  if (type === 'sp' && (!Number.isInteger(spAmount) || (spAmount as number) <= 0)) {
    res.status(400).json({ error: 'Le montant SP doit être un entier positif' });
    return;
  }

  const reward = await gamblingService.addReward({
    crateId,
    type,
    title,
    imageUrl: imageUrl || null,
    spAmount: type === 'sp' ? (spAmount as number) : null,
    weight: weight as number,
  });
  res.status(201).json(reward);
}

interface UpdateRewardBody {
  title?: string;
  imageUrl?: string | null;
  spAmount?: number | null;
  weight?: number;
}

export async function updateReward(
  req: Request<{ id: string; rewardId: string }, {}, UpdateRewardBody>,
  res: Response
): Promise<void> {
  const crateId = Number(req.params.id);
  const rewardId = Number(req.params.rewardId);
  if (!Number.isInteger(crateId) || !Number.isInteger(rewardId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const existing = await gamblingService.getRewardById(rewardId);
  if (!existing || existing.crate_id !== crateId) {
    res.status(404).json({ error: 'Gain introuvable' });
    return;
  }

  const body = req.body ?? {};
  if (body.weight !== undefined && (!Number.isInteger(body.weight) || body.weight <= 0)) {
    res.status(400).json({ error: 'Le poids doit être un entier positif' });
    return;
  }
  if (
    existing.type === 'sp' &&
    body.spAmount !== undefined &&
    body.spAmount !== null &&
    (!Number.isInteger(body.spAmount) || body.spAmount <= 0)
  ) {
    res.status(400).json({ error: 'Le montant SP doit être un entier positif' });
    return;
  }

  const updated = await gamblingService.updateReward(rewardId, {
    title: body.title?.trim(),
    imageUrl: body.imageUrl !== undefined ? body.imageUrl?.trim() || null : undefined,
    spAmount: body.spAmount ?? undefined,
    weight: body.weight,
  });
  res.json(updated);
}

export async function removeReward(
  req: Request<{ id: string; rewardId: string }>,
  res: Response
): Promise<void> {
  const crateId = Number(req.params.id);
  const rewardId = Number(req.params.rewardId);
  if (!Number.isInteger(crateId) || !Number.isInteger(rewardId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const existing = await gamblingService.getRewardById(rewardId);
  if (!existing || existing.crate_id !== crateId) {
    res.status(404).json({ error: 'Gain introuvable' });
    return;
  }

  try {
    await gamblingService.removeReward(rewardId);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(204).end();
}

export async function openCrate(req: Request<{ id: string }>, res: Response): Promise<void> {
  const crateId = Number(req.params.id);
  if (!Number.isInteger(crateId)) {
    res.status(400).json({ error: 'Identifiant de caisse invalide' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await gamblingService.openCrate(req.user!.id, crateId, activeSeason?.id ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);
  res.status(201).json({
    reward: result.reward,
    balance: result.balance,
    spentToday: result.spentToday,
    maxWagerPerDay,
  });
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  const [enabled, maxWagerPerDay, spentToday] = await Promise.all([
    configService.getConfigBool('gambling_enabled', true),
    configService.getConfigNumber('gambling_max_wager_per_day', 50),
    gamblingService.getTodaySpend(req.user!.id),
  ]);
  res.json({ enabled, maxWagerPerDay, spentToday });
}

export async function listMyInventory(req: Request, res: Response): Promise<void> {
  const inventory = await gamblingService.listMyInventory(req.user!.id);
  res.json(inventory);
}

export async function listMyOpens(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const opens = await gamblingService.listMyOpens(req.user!.id, limit);
  res.json(opens);
}
