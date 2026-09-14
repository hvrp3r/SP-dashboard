import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as subscriptionService from './subscription.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import * as gamblingService from './gambling.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  CosmeticRow,
  GamblingBattleActionResult,
  GamblingBattleCrateEntry,
  GamblingBattleListEntry,
  GamblingBattleOpenEntry,
  GamblingBattleParticipantEntry,
  GamblingBattleParticipantRow,
  GamblingBattlePublicView,
  GamblingBattleRow,
  GamblingBattleWinnerEntry,
  GamblingCrateRewardRow,
  GamblingRewardType,
} from '../types.js';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MAX_CRATES_PER_BATTLE = 10;

/**
 * Durée d'un rouleau (ms) — chaque caisse de la bataille se révèle à
 * started_at + position × cette durée, avancé paresseusement à la lecture
 * (même pattern que crash_rounds/blackjack_sessions, voir syncBattle). Envoyée
 * au client dans la vue publique (`stepDurationMs`) plutôt que dupliquée en
 * dur côté client : contrairement à la formule de croissance du crash (qui a
 * besoin d'une interpolation continue entre deux sondages), une simple durée
 * fixe n'a aucune raison de vivre indépendamment des deux côtés.
 */
const STEP_DURATION_MS = 6000;

async function isGamblingEnabled(): Promise<boolean> {
  return configService.getConfigBool('gambling_enabled', true);
}

async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

async function getBattleRow(id: number): Promise<GamblingBattleRow | null> {
  const { rows } = await pool.query<GamblingBattleRow>(
    'SELECT * FROM gambling_battles WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

async function listBattleCrates(battleId: number): Promise<GamblingBattleCrateEntry[]> {
  const { rows } = await pool.query<GamblingBattleCrateEntry>(
    `SELECT bc.id, bc.battle_id, bc.crate_id, bc.position,
            c.name AS crate_name, c.image_url AS crate_image_url, c.cost_sp AS crate_cost_sp
     FROM gambling_battle_crates bc
     JOIN gambling_crates c ON c.id = bc.crate_id
     WHERE bc.battle_id = $1
     ORDER BY bc.position ASC`,
    [battleId]
  );
  return rows;
}

async function listParticipants(
  battleId: number,
  completedSteps: number
): Promise<GamblingBattleParticipantEntry[]> {
  const { rows } = await pool.query<
    Omit<GamblingBattleParticipantEntry, 'equipped_cosmetics' | 'revealed_sp_total'>
  >(
    `SELECT p.*, u.username, u.avatar_url
     FROM gambling_battle_participants p
     JOIN users u ON u.id = p.user_id
     WHERE p.battle_id = $1
     ORDER BY p.joined_at ASC`,
    [battleId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));

  const { rows: totals } = await pool.query<{ participant_id: number; total: string | null }>(
    `SELECT bo.participant_id, SUM(r.sp_amount) AS total
     FROM gambling_battle_opens bo
     JOIN gambling_battle_crates bc ON bc.id = bo.battle_crate_id
     JOIN gambling_crate_rewards r ON r.id = bo.reward_id
     WHERE bc.battle_id = $1 AND bc.position < $2 AND r.type = 'sp'
     GROUP BY bo.participant_id`,
    [battleId, completedSteps]
  );
  const totalByParticipant = new Map(totals.map((t) => [t.participant_id, Number(t.total ?? 0)]));

  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
    revealed_sp_total: totalByParticipant.get(row.id) ?? 0,
  }));
}

/**
 * Tirages déjà révélés (position < visibleSteps) uniquement — jamais les
 * tirages futurs, même si déjà tirés en base au démarrage de la bataille (voir
 * startBattle), pour ne pas gâcher le suspense de l'animation (même principe
 * que crash_point_x100 masqué avant le crash).
 */
async function listVisibleOpens(
  battleId: number,
  visibleSteps: number
): Promise<GamblingBattleOpenEntry[]> {
  if (visibleSteps <= 0) return [];
  const { rows } = await pool.query<
    Omit<GamblingBattleOpenEntry, 'resolved_cosmetic'> & { cosmetic_id: number | null }
  >(
    `SELECT bo.participant_id, bc.position, r.id AS reward_id, r.title AS reward_title,
            r.type AS reward_type, r.image_url AS reward_image_url, r.sp_amount,
            bo.resolved_cosmetic_id AS cosmetic_id
     FROM gambling_battle_opens bo
     JOIN gambling_battle_crates bc ON bc.id = bo.battle_crate_id
     JOIN gambling_crate_rewards r ON r.id = bo.reward_id
     WHERE bc.battle_id = $1 AND bc.position < $2
     ORDER BY bc.position ASC, bo.participant_id ASC`,
    [battleId, visibleSteps]
  );
  const cosmeticIds = [...new Set(rows.map((r) => r.cosmetic_id).filter((id): id is number => id !== null))];
  const cosmeticsById = new Map<number, CosmeticRow>();
  for (const id of cosmeticIds) {
    const c = await cosmeticsService.getCosmeticById(id);
    if (c) cosmeticsById.set(id, c);
  }
  return rows.map(({ cosmetic_id, ...row }) => ({
    ...row,
    resolved_cosmetic: cosmetic_id !== null ? (cosmeticsById.get(cosmetic_id) ?? null) : null,
  }));
}

async function listWinners(battleId: number): Promise<GamblingBattleWinnerEntry[]> {
  const { rows } = await pool.query<Omit<GamblingBattleWinnerEntry, 'equipped_cosmetics'>>(
    `SELECT w.*, u.username, u.avatar_url
     FROM gambling_battle_winners w
     JOIN users u ON u.id = w.user_id
     WHERE w.battle_id = $1
     ORDER BY w.share_amount DESC, u.username ASC`,
    [battleId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({ ...row, equipped_cosmetics: equippedByUser.get(row.user_id) ?? [] }));
}

function visibleStepsFor(battle: GamblingBattleRow, totalSteps: number): number {
  if (battle.status === 'waiting' || battle.status === 'cancelled') return 0;
  if (battle.status === 'completed') return totalSteps;
  if (!battle.started_at) return 0;
  const elapsedMs = Math.max(0, Date.now() - new Date(battle.started_at).getTime());
  const stepsElapsed = Math.floor(elapsedMs / STEP_DURATION_MS);
  // +1 : inclut le tirage de l'étape en cours d'animation (déjà connu côté
  // serveur, seul le landing visuel est retardé côté client) — voir le
  // commentaire d'en-tête sur `opens`.
  return Math.min(totalSteps, stepsElapsed + 1);
}

/**
 * Étapes réellement *terminées* (rouleau posé), par opposition à
 * visibleStepsFor qui inclut l'étape en cours d'animation pour que le rouleau
 * sache déjà où s'arrêter. Sert uniquement au total SP affiché par joueur :
 * l'inclure trop tôt (avec le +1 de visibleStepsFor) ferait sauter le score
 * avant que l'animation du rouleau en cours ne soit terminée, ce qui spoile
 * le résultat et donne l'impression d'un score qui saute tout seul.
 */
function completedStepsFor(battle: GamblingBattleRow, totalSteps: number): number {
  if (battle.status === 'waiting' || battle.status === 'cancelled') return 0;
  if (battle.status === 'completed') return totalSteps;
  if (!battle.started_at) return 0;
  const elapsedMs = Math.max(0, Date.now() - new Date(battle.started_at).getTime());
  const stepsElapsed = Math.floor(elapsedMs / STEP_DURATION_MS);
  return Math.min(totalSteps, stepsElapsed);
}

async function buildPublicView(battle: GamblingBattleRow): Promise<GamblingBattlePublicView> {
  const crates = await listBattleCrates(battle.id);
  const visibleSteps = visibleStepsFor(battle, crates.length);
  const completedSteps = completedStepsFor(battle, crates.length);
  const [participants, opens, winners] = await Promise.all([
    listParticipants(battle.id, completedSteps),
    listVisibleOpens(battle.id, visibleSteps),
    battle.status === 'completed' ? listWinners(battle.id) : Promise.resolve([]),
  ]);
  return {
    ...battle,
    crates,
    participants,
    opens,
    revealedCount: visibleSteps,
    stepDurationMs: STEP_DURATION_MS,
    winners,
  };
}

async function attachListDetails(rows: GamblingBattleRow[]): Promise<GamblingBattleListEntry[]> {
  const result: GamblingBattleListEntry[] = [];
  for (const battle of rows) {
    const [crates, countRows, winners] = await Promise.all([
      listBattleCrates(battle.id),
      pool.query<{ count: string }>(
        'SELECT COUNT(*) FROM gambling_battle_participants WHERE battle_id = $1',
        [battle.id]
      ),
      battle.status === 'completed' ? listWinners(battle.id) : Promise.resolve([]),
    ]);
    result.push({
      ...battle,
      crates,
      participantCount: Number(countRows.rows[0]?.count ?? 0),
      winners,
    });
  }
  return result;
}

export async function listOpenBattles(): Promise<GamblingBattleListEntry[]> {
  const { rows } = await pool.query<GamblingBattleRow>(
    `SELECT * FROM gambling_battles WHERE status IN ('waiting', 'in_progress') ORDER BY created_at DESC`
  );
  return attachListDetails(rows);
}

export async function listHistory(limit: number): Promise<GamblingBattleListEntry[]> {
  const { rows } = await pool.query<GamblingBattleRow>(
    `SELECT * FROM gambling_battles WHERE status = 'completed' ORDER BY completed_at DESC LIMIT $1`,
    [limit]
  );
  return attachListDetails(rows);
}

/**
 * Vérifie, pour chaque caisse distincte du multiset, que le joueur dispose
 * d'assez d'ouvertures restantes sur sa limite `max_opens_per_player` (voir
 * gambling.service.ts#getUserOpenCount, qui compte déjà les tirages de
 * batailles précédentes) pour couvrir le nombre d'occurrences de cette caisse
 * DANS cette bataille — bloque entièrement la création/l'entrée plutôt que de
 * n'ouvrir qu'une partie des caisses, pour ne pas désynchroniser ce joueur des
 * autres participants (tout le monde doit tirer les mêmes caisses).
 */
async function assertWithinOpenLimits(
  client: PoolClient,
  userId: number,
  crateIds: number[]
): Promise<void> {
  const occurrences = new Map<number, number>();
  for (const id of crateIds) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);

  for (const [crateId, count] of occurrences) {
    const crate = await gamblingService.getCrateById(crateId);
    if (!crate || crate.max_opens_per_player === null) continue;
    const used = await gamblingService.getUserOpenCount(userId, crateId, crate.reset_interval_days, client);
    if (used + count > crate.max_opens_per_player) {
      throw Object.assign(
        new Error(
          `Limite d'ouvertures atteinte pour « ${crate.name} » (${used}/${crate.max_opens_per_player}` +
            (count > 1 ? `, cette bataille en utiliserait ${count} de plus)` : ')'),
        ),
        { status: 400 }
      );
    }
  }
}

async function assertWithinDailyBudget(
  client: PoolClient,
  userId: number,
  costSp: number,
  maxWagerPerDay: number
): Promise<void> {
  const { rows } = await client.query<{ spent: string | null }>(
    `SELECT SUM(-amount) AS spent FROM sp_transactions
     WHERE user_id = $1 AND type = 'gambling_spend' AND created_at >= $2`,
    [userId, startOfDayLocalAsUTC()]
  );
  const spentToday = Number(rows[0]?.spent ?? 0);
  if (spentToday + costSp > maxWagerPerDay) {
    throw Object.assign(
      new Error(
        `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
      ),
      { status: 400 }
    );
  }
}

async function assertNoSubscriptionRequired(userId: number, crateIds: number[]): Promise<void> {
  const distinctCrateIds = [...new Set(crateIds)];
  let requiresSubscription = false;
  for (const id of distinctCrateIds) {
    const crate = await gamblingService.getCrateById(id);
    if (crate?.requires_subscription) {
      requiresSubscription = true;
      break;
    }
  }
  if (!requiresSubscription) return;
  const sub = await subscriptionService.getOrCreateForUser(userId);
  if (!subscriptionService.isActive(sub)) {
    throw Object.assign(new Error('Cette bataille contient une caisse réservée aux abonnés'), {
      status: 403,
    });
  }
}

interface CreateBattleInput {
  userId: number;
  seasonId: number | null;
  crateIds: number[];
  maxPlayers: number;
}

export async function createBattle({
  userId,
  seasonId,
  crateIds,
  maxPlayers,
}: CreateBattleInput): Promise<GamblingBattleActionResult> {
  if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    throw Object.assign(
      new Error(`Le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}`),
      { status: 400 }
    );
  }
  if (crateIds.length === 0 || crateIds.length > MAX_CRATES_PER_BATTLE) {
    throw Object.assign(new Error(`Choisis entre 1 et ${MAX_CRATES_PER_BATTLE} caisses`), {
      status: 400,
    });
  }

  const enabled = await isGamblingEnabled();
  if (!enabled) {
    throw Object.assign(new Error('Le gambling est désactivé par le MSP'), { status: 403 });
  }

  let costSp = 0;
  for (const crateId of crateIds) {
    const crate = await gamblingService.getCrateById(crateId);
    if (!crate || !crate.is_active) {
      throw Object.assign(new Error('Une des caisses sélectionnées est introuvable ou archivée'), {
        status: 404,
      });
    }
    const rewards = await gamblingService.listRewards(crateId);
    if (rewards.length === 0) {
      throw Object.assign(new Error(`La caisse « ${crate.name} » n'a aucun gain configuré`), {
        status: 400,
      });
    }
    costSp += crate.cost_sp;
  }

  await assertNoSubscriptionRequired(userId, crateIds);
  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    await assertWithinOpenLimits(client, userId, crateIds);
    await assertWithinDailyBudget(client, userId, costSp, maxWagerPerDay);

    const { rows: battleRows } = await client.query<GamblingBattleRow>(
      `INSERT INTO gambling_battles (season_id, created_by, max_players, cost_sp)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [seasonId, userId, maxPlayers, costSp]
    );
    const battle = battleRows[0] as GamblingBattleRow;

    for (let position = 0; position < crateIds.length; position++) {
      await client.query(
        'INSERT INTO gambling_battle_crates (battle_id, crate_id, position) VALUES ($1, $2, $3)',
        [battle.id, crateIds[position], position]
      );
    }

    let entryTxId: number | null = null;
    if (costSp > 0) {
      const entryTx = await spService.debitSP({
        userId,
        amount: costSp,
        type: 'gambling_spend',
        seasonId,
        relatedId: battle.id,
        note: `Entrée bataille de caisses #${battle.id}`,
        client,
      });
      entryTxId = entryTx.id;
    }

    await client.query(
      `INSERT INTO gambling_battle_participants (battle_id, user_id, is_creator, entry_transaction_id)
       VALUES ($1, $2, TRUE, $3)`,
      [battle.id, userId, entryTxId]
    );

    const balance = await getBalanceInTx(client, userId);
    await client.query('COMMIT');

    const view = await buildPublicView(battle);
    return { battle: view, balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getBalanceInTx(client: PoolClient, userId: number): Promise<number> {
  const { rows } = await client.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

async function resolveCosmeticForDraw(
  reward: GamblingCrateRewardRow,
  client: PoolClient
): Promise<number | null> {
  if (reward.type !== 'cosmetic') return null;
  if (reward.cosmetic_id) return reward.cosmetic_id;
  const cosmetic = await cosmeticsService.pickRandomCosmeticForPool(
    reward.cosmetic_slot_filter,
    reward.cosmetic_rarity_filter,
    client
  );
  return cosmetic.id;
}

/**
 * Tire, pour chaque participant déjà inscrit et chaque caisse de la bataille,
 * un gain pondéré — tout est tiré d'un coup dès que la bataille se remplit
 * (jamais recalculé ensuite), puis révélé progressivement au fil du temps côté
 * lecture (voir visibleStepsFor). Appelée avec la bataille déjà verrouillée
 * (`FOR UPDATE`) par l'appelant (joinBattle).
 */
async function startBattle(
  client: PoolClient,
  battle: GamblingBattleRow,
  battleCrates: GamblingBattleCrateEntry[]
): Promise<GamblingBattleRow> {
  const { rows: participants } = await client.query<GamblingBattleParticipantRow>(
    'SELECT * FROM gambling_battle_participants WHERE battle_id = $1',
    [battle.id]
  );

  const rewardsByCrate = new Map<number, GamblingCrateRewardRow[]>();
  for (const bc of battleCrates) {
    if (!rewardsByCrate.has(bc.crate_id)) {
      rewardsByCrate.set(bc.crate_id, await gamblingService.listRewards(bc.crate_id));
    }
  }

  for (const bc of battleCrates) {
    const rewards = rewardsByCrate.get(bc.crate_id) as GamblingCrateRewardRow[];
    for (const participant of participants) {
      const reward = gamblingService.drawReward(rewards);
      const resolvedCosmeticId = await resolveCosmeticForDraw(reward, client);
      await client.query(
        `INSERT INTO gambling_battle_opens (battle_crate_id, participant_id, reward_id, resolved_cosmetic_id)
         VALUES ($1, $2, $3, $4)`,
        [bc.id, participant.id, reward.id, resolvedCosmeticId]
      );
    }
  }

  const { rows } = await client.query<GamblingBattleRow>(
    `UPDATE gambling_battles SET status = 'in_progress', started_at = NOW() WHERE id = $1 RETURNING *`,
    [battle.id]
  );
  return rows[0] as GamblingBattleRow;
}

export async function joinBattle(
  userId: number,
  battleId: number,
  seasonId: number | null
): Promise<GamblingBattleActionResult> {
  const enabled = await isGamblingEnabled();
  if (!enabled) {
    throw Object.assign(new Error('Le gambling est désactivé par le MSP'), { status: 403 });
  }
  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: battleRows } = await client.query<GamblingBattleRow>(
      'SELECT * FROM gambling_battles WHERE id = $1 FOR UPDATE',
      [battleId]
    );
    const battle = battleRows[0];
    if (!battle) {
      throw Object.assign(new Error('Bataille introuvable'), { status: 404 });
    }
    if (battle.status !== 'waiting') {
      throw Object.assign(new Error('Cette bataille a déjà démarré ou est terminée'), {
        status: 409,
      });
    }

    const { rows: existingRows } = await client.query(
      'SELECT id FROM gambling_battle_participants WHERE battle_id = $1 AND user_id = $2',
      [battle.id, userId]
    );
    if (existingRows.length > 0) {
      throw Object.assign(new Error('Tu participes déjà à cette bataille'), { status: 400 });
    }

    const { rows: countRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) FROM gambling_battle_participants WHERE battle_id = $1',
      [battle.id]
    );
    const participantCount = Number(countRows[0]?.count ?? 0);
    if (participantCount >= battle.max_players) {
      throw Object.assign(new Error('Cette bataille est complète'), { status: 400 });
    }

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const battleCrates = await listBattleCrates(battle.id);
    const crateIds = battleCrates.map((c) => c.crate_id);

    await assertNoSubscriptionRequired(userId, crateIds);
    await assertWithinOpenLimits(client, userId, crateIds);
    await assertWithinDailyBudget(client, userId, battle.cost_sp, maxWagerPerDay);

    let entryTxId: number | null = null;
    if (battle.cost_sp > 0) {
      const entryTx = await spService.debitSP({
        userId,
        amount: battle.cost_sp,
        type: 'gambling_spend',
        seasonId: battle.season_id,
        relatedId: battle.id,
        note: `Entrée bataille de caisses #${battle.id}`,
        client,
      });
      entryTxId = entryTx.id;
    }

    await client.query(
      `INSERT INTO gambling_battle_participants (battle_id, user_id, is_creator, entry_transaction_id)
       VALUES ($1, $2, FALSE, $3)`,
      [battle.id, userId, entryTxId]
    );

    let updatedBattle = battle;
    if (participantCount + 1 === battle.max_players) {
      updatedBattle = await startBattle(client, battle, battleCrates);
    }

    const balance = await getBalanceInTx(client, userId);
    await client.query('COMMIT');

    const view = await buildPublicView(updatedBattle);
    return { battle: view, balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Calcule le vainqueur (ou les vainqueurs ex æquo) au total SP tiré, crédite
 * le pot entier (somme des SP tirés par TOUS les participants) — partagé à
 * parts égales en cas d'égalité, l'éventuel reste distribué un par un aux
 * premiers arrivés — et accorde à CHAQUE vainqueur tous les gains 'custom'
 * et 'cosmetic' tirés par n'importe quel participant pendant la bataille
 * (dupliqués pour chaque vainqueur ex æquo) : décision explicite de
 * l'utilisateur, "winner takes all" s'applique aussi aux cosmétiques, pas
 * seulement aux SP. Les perdants ne gardent rien de ce qu'ils ont tiré.
 */
async function resolveBattle(client: PoolClient, battle: GamblingBattleRow): Promise<GamblingBattleRow> {
  const { rows: participants } = await client.query<GamblingBattleParticipantRow>(
    'SELECT * FROM gambling_battle_participants WHERE battle_id = $1 ORDER BY joined_at ASC',
    [battle.id]
  );

  const { rows: openRows } = await client.query<{
    participant_id: number;
    reward_id: number;
    resolved_cosmetic_id: number | null;
    type: GamblingRewardType;
    sp_amount: number | null;
    cosmetic_id: number | null;
  }>(
    `SELECT bo.participant_id, bo.reward_id, bo.resolved_cosmetic_id,
            r.type, r.sp_amount, r.cosmetic_id
     FROM gambling_battle_opens bo
     JOIN gambling_battle_crates bc ON bc.id = bo.battle_crate_id
     JOIN gambling_crate_rewards r ON r.id = bo.reward_id
     WHERE bc.battle_id = $1`,
    [battle.id]
  );

  const totalByParticipant = new Map<number, number>();
  for (const p of participants) totalByParticipant.set(p.id, 0);
  let totalPot = 0;
  const nonSpRewards: { rewardId: number; type: 'custom' | 'cosmetic'; cosmeticId: number | null }[] = [];
  for (const row of openRows) {
    if (row.type === 'sp' && row.sp_amount) {
      totalByParticipant.set(row.participant_id, (totalByParticipant.get(row.participant_id) ?? 0) + row.sp_amount);
      totalPot += row.sp_amount;
    } else if (row.type === 'custom') {
      nonSpRewards.push({ rewardId: row.reward_id, type: 'custom', cosmeticId: null });
    } else if (row.type === 'cosmetic') {
      nonSpRewards.push({
        rewardId: row.reward_id,
        type: 'cosmetic',
        cosmeticId: row.resolved_cosmetic_id ?? row.cosmetic_id,
      });
    }
  }

  const maxTotal = Math.max(...participants.map((p) => totalByParticipant.get(p.id) ?? 0));
  const winnerParticipants = participants.filter((p) => (totalByParticipant.get(p.id) ?? 0) === maxTotal);

  const k = winnerParticipants.length;
  const base = Math.floor(totalPot / k);
  const remainder = totalPot % k;

  for (let i = 0; i < winnerParticipants.length; i++) {
    const winner = winnerParticipants[i] as GamblingBattleParticipantRow;
    const share = base + (i < remainder ? 1 : 0);

    let payoutTxId: number | null = null;
    if (share > 0) {
      const tx = await spService.creditSP({
        userId: winner.user_id,
        amount: share,
        type: 'gambling_win',
        seasonId: battle.season_id,
        relatedId: battle.id,
        note:
          k > 1
            ? `Bataille de caisses #${battle.id} — victoire partagée (${share} SP)`
            : `Bataille de caisses #${battle.id} — victoire (${share} SP)`,
        client,
      });
      payoutTxId = tx.id;
    }

    await client.query(
      `INSERT INTO gambling_battle_winners (battle_id, user_id, share_amount, payout_transaction_id)
       VALUES ($1, $2, $3, $4)`,
      [battle.id, winner.user_id, share, payoutTxId]
    );

    for (const reward of nonSpRewards) {
      if (reward.type === 'custom') {
        await client.query(
          `INSERT INTO gambling_inventory (user_id, reward_id, gambling_open_id) VALUES ($1, $2, NULL)`,
          [winner.user_id, reward.rewardId]
        );
      } else if (reward.cosmeticId) {
        await cosmeticsService.grant(winner.user_id, reward.cosmeticId, 'gambling', client);
      }
    }
  }

  const { rows } = await client.query<GamblingBattleRow>(
    `UPDATE gambling_battles SET status = 'completed', completed_at = NOW() WHERE id = $1 RETURNING *`,
    [battle.id]
  );
  return rows[0] as GamblingBattleRow;
}

async function advanceBattle(client: PoolClient, battle: GamblingBattleRow): Promise<GamblingBattleRow> {
  if (battle.status !== 'in_progress' || !battle.started_at) return battle;

  const { rows: crateRows } = await client.query<{ count: string }>(
    'SELECT COUNT(*) FROM gambling_battle_crates WHERE battle_id = $1',
    [battle.id]
  );
  const totalSteps = Number(crateRows[0]?.count ?? 0);
  const elapsedMs = Math.max(0, Date.now() - new Date(battle.started_at).getTime());
  if (elapsedMs < totalSteps * STEP_DURATION_MS) return battle;

  return resolveBattle(client, battle);
}

async function syncBattle(battleId: number): Promise<GamblingBattleRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<GamblingBattleRow>(
      'SELECT * FROM gambling_battles WHERE id = $1 FOR UPDATE',
      [battleId]
    );
    let battle = rows[0];
    if (!battle) {
      throw Object.assign(new Error('Bataille introuvable'), { status: 404 });
    }
    battle = await advanceBattle(client, battle);
    await client.query('COMMIT');
    return battle;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getBattleView(battleId: number, userId: number): Promise<GamblingBattleActionResult> {
  const enabled = await isGamblingEnabled();
  let battle = await getBattleRow(battleId);
  if (!battle) {
    throw Object.assign(new Error('Bataille introuvable'), { status: 404 });
  }
  if (battle.status === 'in_progress') {
    battle = await syncBattle(battleId);
  }
  const [view, balance] = await Promise.all([buildPublicView(battle), getBalance(userId)]);
  return { battle: view, balance, enabled };
}

/**
 * Annule une bataille encore `waiting` (créateur ou MSP) et rembourse
 * l'entrée de chaque participant déjà inscrit — jamais possible une fois les
 * tirages effectués (`in_progress`/`completed`), le résultat est alors
 * définitif comme n'importe quel autre jeu de gambling résolu.
 */
export async function cancelBattle(userId: number, battleId: number, isAdmin: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<GamblingBattleRow>(
      'SELECT * FROM gambling_battles WHERE id = $1 FOR UPDATE',
      [battleId]
    );
    const battle = rows[0];
    if (!battle) {
      throw Object.assign(new Error('Bataille introuvable'), { status: 404 });
    }
    if (battle.status !== 'waiting') {
      throw Object.assign(new Error('Seule une bataille en attente de joueurs peut être annulée'), {
        status: 409,
      });
    }
    if (battle.created_by !== userId && !isAdmin) {
      throw Object.assign(new Error('Tu ne peux annuler que tes propres batailles'), { status: 403 });
    }

    const { rows: participants } = await client.query<GamblingBattleParticipantRow>(
      'SELECT * FROM gambling_battle_participants WHERE battle_id = $1',
      [battle.id]
    );
    for (const p of participants) {
      if (battle.cost_sp > 0) {
        await spService.creditSP({
          userId: p.user_id,
          amount: battle.cost_sp,
          type: 'gambling_refund',
          seasonId: battle.season_id,
          relatedId: battle.id,
          note: `Remboursement — bataille de caisses #${battle.id} annulée`,
          affectsTotalEarned: false,
          client,
        });
      }
    }

    await client.query(
      `UPDATE gambling_battles SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2 WHERE id = $1`,
      [battle.id, userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
