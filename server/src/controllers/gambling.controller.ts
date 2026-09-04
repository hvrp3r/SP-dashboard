import type { Request, Response } from 'express';
import * as gamblingService from '../services/gambling.service.js';
import * as configService from '../services/config.service.js';
import * as seasonService from '../services/season.service.js';
import * as subscriptionService from '../services/subscription.service.js';
import * as cosmeticsService from '../services/cosmetics.service.js';
import * as notificationService from '../services/notification.service.js';
import { BLACKJACK_RTP_PERCENT } from '../services/blackjack.service.js';
import type {
  CosmeticRarity,
  CosmeticSlot,
  GamblingCrateRewardRow,
  GamblingCrateRewardView,
  GamblingGameInfo,
  GamblingRewardType,
} from '../types.js';

const VALID_REWARD_TYPES: GamblingRewardType[] = ['sp', 'custom', 'cosmetic'];
const VALID_COSMETIC_SLOTS: CosmeticSlot[] = ['avatar_frame', 'banner', 'name_color', 'title', 'name_font'];
const VALID_COSMETIC_RARITIES: CosmeticRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

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
  const myOpenCount = await gamblingService.getUserOpenCount(
    req.user!.id,
    crateId,
    crate.reset_interval_days
  );
  res.json({ ...crate, rewards: withPercent(rewards), myOpenCount });
}

interface CreateCrateBody {
  name?: string;
  description?: string;
  imageUrl?: string;
  costSp?: number;
  maxOpensPerPlayer?: number | null;
  resetIntervalDays?: number | null;
  requiresSubscription?: boolean;
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
  const resetIntervalDays = req.body?.resetIntervalDays;

  if (!name) {
    res.status(400).json({ error: 'Le nom est requis' });
    return;
  }
  if (!Number.isInteger(costSp) || (costSp as number) < 0) {
    res.status(400).json({ error: 'Le coût doit être un entier positif ou nul (caisse gratuite)' });
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
  if (
    resetIntervalDays !== undefined &&
    resetIntervalDays !== null &&
    (!Number.isInteger(resetIntervalDays) || resetIntervalDays <= 0)
  ) {
    res
      .status(400)
      .json({ error: "L'intervalle de réinitialisation doit être un entier positif (en jours)" });
    return;
  }

  let crate;
  try {
    crate = await gamblingService.createCrate({
      name,
      description: description || null,
      imageUrl: imageUrl || null,
      costSp: costSp as number,
      maxOpensPerPlayer: maxOpensPerPlayer ?? null,
      resetIntervalDays: resetIntervalDays ?? null,
      requiresSubscription: req.body?.requiresSubscription === true,
      createdBy: req.user!.id,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(201).json(crate);
}

interface UpdateCrateBody {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  costSp?: number;
  maxOpensPerPlayer?: number | null;
  resetIntervalDays?: number | null;
  requiresSubscription?: boolean;
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
  if (body.costSp !== undefined && (!Number.isInteger(body.costSp) || body.costSp < 0)) {
    res.status(400).json({ error: 'Le coût doit être un entier positif ou nul (caisse gratuite)' });
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
  if (
    body.resetIntervalDays !== undefined &&
    body.resetIntervalDays !== null &&
    (!Number.isInteger(body.resetIntervalDays) || body.resetIntervalDays <= 0)
  ) {
    res
      .status(400)
      .json({ error: "L'intervalle de réinitialisation doit être un entier positif (en jours)" });
    return;
  }

  let updated;
  try {
    updated = await gamblingService.updateCrate(crateId, {
      name: body.name?.trim(),
      description: body.description !== undefined ? body.description?.trim() || null : undefined,
      imageUrl: body.imageUrl !== undefined ? body.imageUrl?.trim() || null : undefined,
      costSp: body.costSp,
      maxOpensPerPlayer: body.maxOpensPerPlayer,
      resetIntervalDays: body.resetIntervalDays,
      requiresSubscription: body.requiresSubscription,
      isActive: body.isActive,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
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

/**
 * Une récompense 'cosmetic' est soit précise (cosmeticId, aucun filtre), soit
 * un "pool" (pas de cosmeticId, au moins un filtre catégorie/rareté) —
 * réutilisé par addReward et updateReward. Retourne un message d'erreur ou
 * `null` si valide.
 */
async function validateCosmeticRewardTarget(
  cosmeticId: number | null | undefined,
  slotFilter: CosmeticSlot | null | undefined,
  rarityFilter: CosmeticRarity | null | undefined
): Promise<string | null> {
  const hasCosmeticId = cosmeticId !== null && cosmeticId !== undefined;
  const hasSlotFilter = slotFilter !== null && slotFilter !== undefined;
  const hasRarityFilter = rarityFilter !== null && rarityFilter !== undefined;

  if (hasSlotFilter && !VALID_COSMETIC_SLOTS.includes(slotFilter as CosmeticSlot)) {
    return 'Catégorie de filtre invalide';
  }
  if (hasRarityFilter && !VALID_COSMETIC_RARITIES.includes(rarityFilter as CosmeticRarity)) {
    return 'Rareté de filtre invalide';
  }

  if (hasCosmeticId) {
    if (hasSlotFilter || hasRarityFilter) {
      return 'Un cosmétique précis ne peut pas avoir de filtre catégorie/rareté';
    }
    const cosmetic = await cosmeticsService.getCosmeticById(cosmeticId as number);
    if (!cosmetic) return 'Cosmétique introuvable';
    return null;
  }

  if (!hasSlotFilter && !hasRarityFilter) {
    return 'Choisis un cosmétique précis ou un filtre catégorie/rareté';
  }

  const matches = await cosmeticsService.listCosmeticsForPool(
    hasSlotFilter ? (slotFilter as CosmeticSlot) : null,
    hasRarityFilter ? (rarityFilter as CosmeticRarity) : null
  );
  if (matches.length === 0) {
    return 'Aucun cosmétique du catalogue ne correspond à ce filtre';
  }
  return null;
}

interface AddRewardBody {
  type?: GamblingRewardType;
  title?: string;
  imageUrl?: string;
  spAmount?: number;
  cosmeticId?: number;
  cosmeticSlotFilter?: CosmeticSlot;
  cosmeticRarityFilter?: CosmeticRarity;
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
  const cosmeticId = req.body?.cosmeticId;
  const cosmeticSlotFilter = req.body?.cosmeticSlotFilter;
  const cosmeticRarityFilter = req.body?.cosmeticRarityFilter;
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
  if (type === 'cosmetic') {
    const error = await validateCosmeticRewardTarget(
      cosmeticId,
      cosmeticSlotFilter,
      cosmeticRarityFilter
    );
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }

  const reward = await gamblingService.addReward({
    crateId,
    type,
    title,
    imageUrl: imageUrl || null,
    spAmount: type === 'sp' ? (spAmount as number) : null,
    cosmeticId: type === 'cosmetic' ? (cosmeticId ?? null) : null,
    cosmeticSlotFilter: type === 'cosmetic' ? (cosmeticSlotFilter ?? null) : null,
    cosmeticRarityFilter: type === 'cosmetic' ? (cosmeticRarityFilter ?? null) : null,
    weight: weight as number,
  });
  res.status(201).json(reward);
}

interface UpdateRewardBody {
  title?: string;
  imageUrl?: string | null;
  spAmount?: number | null;
  cosmeticId?: number | null;
  cosmeticSlotFilter?: CosmeticSlot | null;
  cosmeticRarityFilter?: CosmeticRarity | null;
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
  if (
    existing.type === 'cosmetic' &&
    (body.cosmeticId !== undefined ||
      body.cosmeticSlotFilter !== undefined ||
      body.cosmeticRarityFilter !== undefined)
  ) {
    const nextCosmeticId = body.cosmeticId !== undefined ? body.cosmeticId : existing.cosmetic_id;
    const nextSlotFilter =
      body.cosmeticSlotFilter !== undefined ? body.cosmeticSlotFilter : existing.cosmetic_slot_filter;
    const nextRarityFilter =
      body.cosmeticRarityFilter !== undefined
        ? body.cosmeticRarityFilter
        : existing.cosmetic_rarity_filter;
    const error = await validateCosmeticRewardTarget(nextCosmeticId, nextSlotFilter, nextRarityFilter);
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }

  const updated = await gamblingService.updateReward(rewardId, {
    title: body.title?.trim(),
    imageUrl: body.imageUrl !== undefined ? body.imageUrl?.trim() || null : undefined,
    spAmount: body.spAmount ?? undefined,
    cosmeticId: body.cosmeticId,
    cosmeticSlotFilter: body.cosmeticSlotFilter,
    cosmeticRarityFilter: body.cosmeticRarityFilter,
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

  if (result.reward.type === 'cosmetic') {
    await notificationService.createNotification({
      userId: req.user!.id,
      type: 'cosmetic_earned',
      message: `Tu as gagné le cosmétique « ${result.reward.title} » !`,
      link: '/cosmetiques',
    });
  }

  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);
  res.status(201).json({
    reward: result.reward,
    cosmetic: result.cosmetic,
    balance: result.balance,
    spentToday: result.spentToday,
    maxWagerPerDay,
  });
}

/**
 * Registre des jeux de la section gambling — sert à la fois le menu déroulant
 * de la navbar et la page /gambling (liste des jeux). Un jeu désactivé par le
 * MSP (`admin_config`) n'y apparaît pas ; il reste néanmoins accessible par son
 * URL directe (même logique que les caisses archivées : masqué de la liste,
 * pas bloqué en accès direct).
 */
export async function listGames(req: Request, res: Response): Promise<void> {
  const [cratesEnabled, blackjackEnabled] = await Promise.all([
    configService.getConfigBool('gambling_enabled', true),
    configService.getConfigBool('blackjack_enabled', false),
  ]);
  const games: GamblingGameInfo[] = [
    {
      id: 'crates',
      name: 'Caisses',
      description: 'Ouvre des caisses configurées par le MSP pour tenter ta chance.',
      path: '/gambling/crates',
      enabled: cratesEnabled,
      rtp: null,
    },
    {
      id: 'blackjack',
      name: 'Blackjack',
      description: 'Affronte le croupier en multijoueur, mise ce que tu veux.',
      path: '/gambling/blackjack',
      enabled: blackjackEnabled,
      rtp: BLACKJACK_RTP_PERCENT,
    },
  ];
  res.json(games);
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  const [enabled, maxWagerPerDay, spentToday, subscription] = await Promise.all([
    configService.getConfigBool('gambling_enabled', true),
    configService.getConfigNumber('gambling_max_wager_per_day', 50),
    gamblingService.getTodaySpend(req.user!.id),
    subscriptionService.getOrCreateForUser(req.user!.id),
  ]);
  res.json({
    enabled,
    maxWagerPerDay,
    spentToday,
    subscriptionActive: subscriptionService.isActive(subscription),
  });
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
