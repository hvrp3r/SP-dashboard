import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as subscriptionService from './subscription.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  GamblingCrateEntry,
  GamblingCrateRewardRow,
  GamblingCrateRow,
  GamblingInventoryEntry,
  GamblingOpenEntry,
  GamblingOpenRow,
  GamblingRewardType,
} from '../types.js';

export async function listCrates(
  includeInactive: boolean,
  userId: number
): Promise<GamblingCrateEntry[]> {
  const { rows } = await pool.query<GamblingCrateRow & { my_open_count: string }>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM gambling_opens o WHERE o.crate_id = c.id AND o.user_id = $1
        AND (c.reset_interval_days IS NULL OR o.opened_at >= gambling_period_start(c.reset_interval_days))
       ) AS my_open_count
     FROM gambling_crates c
     ${includeInactive ? '' : 'WHERE c.is_active = true'}
     ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows.map(({ my_open_count, ...crate }) => ({
    ...crate,
    myOpenCount: Number(my_open_count),
  }));
}

export async function getCrateById(id: number): Promise<GamblingCrateRow | null> {
  const { rows } = await pool.query<GamblingCrateRow>(
    'SELECT * FROM gambling_crates WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

interface CreateCrateInput {
  name: string;
  description: string | null;
  imageUrl: string | null;
  costSp: number;
  maxOpensPerPlayer: number | null;
  resetIntervalDays: number | null;
  requiresSubscription: boolean;
  createdBy: number;
}

export async function createCrate({
  name,
  description,
  imageUrl,
  costSp,
  maxOpensPerPlayer,
  resetIntervalDays,
  requiresSubscription,
  createdBy,
}: CreateCrateInput): Promise<GamblingCrateRow> {
  if (costSp === 0 && maxOpensPerPlayer === null) {
    throw Object.assign(
      new Error("Une caisse gratuite doit avoir une limite d'ouvertures par joueur"),
      { status: 400 }
    );
  }
  if (resetIntervalDays !== null && maxOpensPerPlayer === null) {
    throw Object.assign(
      new Error("Un intervalle de réinitialisation nécessite une limite d'ouvertures par joueur"),
      { status: 400 }
    );
  }

  const { rows } = await pool.query<GamblingCrateRow>(
    `INSERT INTO gambling_crates (name, description, image_url, cost_sp, max_opens_per_player, reset_interval_days, requires_subscription, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      name,
      description,
      imageUrl,
      costSp,
      maxOpensPerPlayer,
      resetIntervalDays,
      requiresSubscription,
      createdBy,
    ]
  );
  return rows[0] as GamblingCrateRow;
}

interface UpdateCrateInput {
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
  id: number,
  patch: UpdateCrateInput
): Promise<GamblingCrateRow | null> {
  const current = await getCrateById(id);
  if (!current) return null;

  const next = {
    name: patch.name ?? current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    image_url: patch.imageUrl !== undefined ? patch.imageUrl : current.image_url,
    cost_sp: patch.costSp ?? current.cost_sp,
    max_opens_per_player:
      patch.maxOpensPerPlayer !== undefined ? patch.maxOpensPerPlayer : current.max_opens_per_player,
    reset_interval_days:
      patch.resetIntervalDays !== undefined ? patch.resetIntervalDays : current.reset_interval_days,
    requires_subscription: patch.requiresSubscription ?? current.requires_subscription,
    is_active: patch.isActive ?? current.is_active,
  };

  if (next.cost_sp === 0 && next.max_opens_per_player === null) {
    throw Object.assign(
      new Error("Une caisse gratuite doit avoir une limite d'ouvertures par joueur"),
      { status: 400 }
    );
  }
  if (next.reset_interval_days !== null && next.max_opens_per_player === null) {
    throw Object.assign(
      new Error("Un intervalle de réinitialisation nécessite une limite d'ouvertures par joueur"),
      { status: 400 }
    );
  }

  const { rows } = await pool.query<GamblingCrateRow>(
    `UPDATE gambling_crates
     SET name = $1, description = $2, image_url = $3, cost_sp = $4, max_opens_per_player = $5,
         reset_interval_days = $6, requires_subscription = $7, is_active = $8
     WHERE id = $9
     RETURNING *`,
    [
      next.name,
      next.description,
      next.image_url,
      next.cost_sp,
      next.max_opens_per_player,
      next.reset_interval_days,
      next.requires_subscription,
      next.is_active,
      id,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Supprime une caisse et son pool de récompenses. Refuse si la caisse a déjà été
 * ouverte au moins une fois (gambling_opens la référence, pour la traçabilité
 * anti-triche) — dans ce cas le MSP doit l'archiver (`is_active = false`) plutôt
 * que la supprimer : une caisse archivée disparaît de la liste des joueurs (et de
 * la liste par défaut du MSP, qui doit cliquer sur « Voir les caisses archivées »
 * pour la retrouver) sans perdre son historique d'ouvertures.
 */
export async function removeCrate(id: number): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM gambling_opens WHERE crate_id = $1',
    [id]
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw Object.assign(
      new Error(
        'Cette caisse a déjà été ouverte, elle ne peut plus être supprimée — archive-la plutôt'
      ),
      { status: 409 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM gambling_crate_rewards WHERE crate_id = $1', [id]);
    await client.query('DELETE FROM gambling_crates WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Triée par poids croissant (donc du plus rare au plus commun) — c'est l'ordre
 * d'affichage attendu côté joueur ("Gains possibles") et côté MSP ("Gérer les
 * gains"), les deux réutilisant cette même liste.
 */
export async function listRewards(crateId: number): Promise<GamblingCrateRewardRow[]> {
  const { rows } = await pool.query<GamblingCrateRewardRow>(
    'SELECT * FROM gambling_crate_rewards WHERE crate_id = $1 ORDER BY weight ASC, created_at ASC',
    [crateId]
  );
  return rows;
}

export async function getRewardById(id: number): Promise<GamblingCrateRewardRow | null> {
  const { rows } = await pool.query<GamblingCrateRewardRow>(
    'SELECT * FROM gambling_crate_rewards WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

interface AddRewardInput {
  crateId: number;
  type: GamblingRewardType;
  title: string;
  imageUrl: string | null;
  spAmount: number | null;
  weight: number;
}

export async function addReward({
  crateId,
  type,
  title,
  imageUrl,
  spAmount,
  weight,
}: AddRewardInput): Promise<GamblingCrateRewardRow> {
  const { rows } = await pool.query<GamblingCrateRewardRow>(
    `INSERT INTO gambling_crate_rewards (crate_id, type, title, image_url, sp_amount, weight)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [crateId, type, title, imageUrl, type === 'sp' ? spAmount : null, weight]
  );
  return rows[0] as GamblingCrateRewardRow;
}

interface UpdateRewardInput {
  title?: string;
  imageUrl?: string | null;
  spAmount?: number | null;
  weight?: number;
}

export async function updateReward(
  id: number,
  patch: UpdateRewardInput
): Promise<GamblingCrateRewardRow | null> {
  const current = await getRewardById(id);
  if (!current) return null;

  const next = {
    title: patch.title ?? current.title,
    image_url: patch.imageUrl !== undefined ? patch.imageUrl : current.image_url,
    sp_amount: current.type === 'sp' ? (patch.spAmount ?? current.sp_amount) : null,
    weight: patch.weight ?? current.weight,
  };

  const { rows } = await pool.query<GamblingCrateRewardRow>(
    `UPDATE gambling_crate_rewards SET title = $1, image_url = $2, sp_amount = $3, weight = $4
     WHERE id = $5
     RETURNING *`,
    [next.title, next.image_url, next.sp_amount, next.weight, id]
  );
  return rows[0] ?? null;
}

export async function removeReward(id: number): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM gambling_opens WHERE reward_id = $1',
    [id]
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw Object.assign(new Error('Ce gain a déjà été tiré, il ne peut plus être supprimé'), {
      status: 409,
    });
  }
  await pool.query('DELETE FROM gambling_crate_rewards WHERE id = $1', [id]);
}

/**
 * Compte les ouvertures d'une caisse par un joueur — sur toute la période
 * (reset_interval_days = null) ou seulement depuis le début de la période de
 * reset en cours (voir gambling_period_start() dans la migration 022).
 * Accepte `pool` ou un `PoolClient` d'une transaction déjà ouverte (résolution
 * d'ouverture dans openCrate) pour lire un compte cohérent avec le verrou de
 * ligne posé sur l'utilisateur.
 */
export async function getUserOpenCount(
  userId: number,
  crateId: number,
  resetIntervalDays: number | null = null,
  db: Pool | PoolClient = pool
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM gambling_opens
     WHERE user_id = $1 AND crate_id = $2
     AND ($3::int IS NULL OR opened_at >= gambling_period_start($3::int))`,
    [userId, crateId, resetIntervalDays]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getTodaySpend(userId: number): Promise<number> {
  const { rows } = await pool.query<{ spent: string | null }>(
    `SELECT SUM(-amount) AS spent FROM sp_transactions
     WHERE user_id = $1 AND type = 'gambling_spend' AND created_at >= $2`,
    [userId, startOfDayLocalAsUTC()]
  );
  return Number(rows[0]?.spent ?? 0);
}

function drawReward(rewards: GamblingCrateRewardRow[]): GamblingCrateRewardRow {
  const totalWeight = rewards.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const reward of rewards) {
    roll -= reward.weight;
    if (roll < 0) return reward;
  }
  return rewards[rewards.length - 1] as GamblingCrateRewardRow;
}

interface OpenCrateResult {
  open: GamblingOpenRow;
  reward: GamblingCrateRewardRow;
  balance: number;
  spentToday: number;
}

/**
 * Ouvre une caisse : débite le coût, tire un gain pondéré, crédite le gain SP
 * s'il y en a un. Le verrou de ligne sur l'utilisateur sérialise les ouvertures
 * concurrentes du même joueur — sans lui, deux requêtes parallèles pourraient
 * toutes les deux lire un budget quotidien (ou un nombre d'ouvertures déjà
 * effectuées sur cette caisse) encore sous le plafond avant qu'aucune n'ait
 * débité/inséré, et le dépasser (même raison que le bonus de connexion, voir
 * loginBonus.service.ts).
 */
export async function openCrate(
  userId: number,
  crateId: number,
  seasonId: number | null
): Promise<OpenCrateResult> {
  const crate = await getCrateById(crateId);
  if (!crate || !crate.is_active) {
    throw Object.assign(new Error('Caisse introuvable ou archivée'), { status: 404 });
  }

  const enabled = await configService.getConfigBool('gambling_enabled', true);
  if (!enabled) {
    throw Object.assign(new Error('Le gambling est désactivé par le MSP'), { status: 403 });
  }

  if (crate.requires_subscription) {
    const sub = await subscriptionService.getOrCreateForUser(userId);
    if (!subscriptionService.isActive(sub)) {
      throw Object.assign(new Error('Cette caisse est réservée aux abonnés'), { status: 403 });
    }
  }

  const rewards = await listRewards(crateId);
  if (rewards.length === 0) {
    throw Object.assign(new Error('Cette caisse n’a aucun gain configuré'), { status: 400 });
  }

  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: spentRows } = await client.query<{ spent: string | null }>(
      `SELECT SUM(-amount) AS spent FROM sp_transactions
       WHERE user_id = $1 AND type = 'gambling_spend' AND created_at >= $2`,
      [userId, startOfDayLocalAsUTC()]
    );
    const spentToday = Number(spentRows[0]?.spent ?? 0);
    if (spentToday + crate.cost_sp > maxWagerPerDay) {
      throw Object.assign(
        new Error(
          `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
        ),
        { status: 400 }
      );
    }

    if (crate.max_opens_per_player !== null) {
      const openCount = await getUserOpenCount(userId, crateId, crate.reset_interval_days, client);
      if (openCount >= crate.max_opens_per_player) {
        throw Object.assign(
          new Error(
            `Tu as atteint la limite d'ouvertures pour cette caisse (${openCount}/${crate.max_opens_per_player})`
          ),
          { status: 400 }
        );
      }
    }

    let spTransactionId: number | null = null;
    if (crate.cost_sp > 0) {
      const spendTx = await spService.debitSP({
        userId,
        amount: crate.cost_sp,
        type: 'gambling_spend',
        seasonId,
        relatedId: crateId,
        note: `Ouverture caisse « ${crate.name} »`,
        client,
      });
      spTransactionId = spendTx.id;
    }

    const reward = drawReward(rewards);

    if (reward.type === 'sp' && reward.sp_amount) {
      const winTx = await spService.creditSP({
        userId,
        amount: reward.sp_amount,
        type: 'gambling_win',
        seasonId,
        relatedId: crateId,
        note: `Gain caisse « ${crate.name} » — ${reward.title}`,
        client,
      });
      spTransactionId = winTx.id;
    }

    const { rows: openRows } = await client.query<GamblingOpenRow>(
      `INSERT INTO gambling_opens (user_id, crate_id, reward_id, season_id, sp_transaction_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, crateId, reward.id, seasonId, spTransactionId]
    );
    const open = openRows[0] as GamblingOpenRow;

    if (reward.type === 'custom') {
      await client.query(
        `INSERT INTO gambling_inventory (user_id, reward_id, gambling_open_id)
         VALUES ($1, $2, $3)`,
        [userId, reward.id, open.id]
      );
    }

    const { rows: userRows } = await client.query<{ sp_balance: number }>(
      'SELECT sp_balance FROM users WHERE id = $1',
      [userId]
    );

    await client.query('COMMIT');

    return {
      open,
      reward,
      balance: userRows[0]?.sp_balance ?? 0,
      spentToday: spentToday + crate.cost_sp,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyInventory(userId: number): Promise<GamblingInventoryEntry[]> {
  const { rows } = await pool.query<GamblingInventoryEntry>(
    `SELECT i.id, i.user_id, i.reward_id, i.gambling_open_id, i.obtained_at,
            r.title, r.image_url
     FROM gambling_inventory i
     JOIN gambling_crate_rewards r ON r.id = i.reward_id
     WHERE i.user_id = $1
     ORDER BY i.obtained_at DESC`,
    [userId]
  );
  return rows;
}

export async function listMyOpens(userId: number, limit: number): Promise<GamblingOpenEntry[]> {
  const { rows } = await pool.query<GamblingOpenEntry>(
    `SELECT o.id, o.user_id, o.crate_id, o.reward_id, o.season_id, o.sp_transaction_id, o.opened_at,
            c.name AS crate_name, r.title AS reward_title, r.type AS reward_type,
            r.image_url AS reward_image_url, r.sp_amount
     FROM gambling_opens o
     JOIN gambling_crates c ON c.id = o.crate_id
     JOIN gambling_crate_rewards r ON r.id = o.reward_id
     WHERE o.user_id = $1
     ORDER BY o.opened_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
