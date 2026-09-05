import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  CrashActionResult,
  CrashBetEntry,
  CrashBetRow,
  CrashHistoryEntry,
  CrashRoundPublicView,
  CrashRoundRow,
} from '../types.js';

const BETTING_WINDOW_SECONDS = 10;
/** Délai pendant lequel une manche `crashed` reste affichée avant qu'une nouvelle `betting` la remplace. */
const RESULTS_DISPLAY_SECONDS = 5;

/**
 * Vitesse de croissance du multiplicateur : m(t) = e^(GROWTH_PER_SECOND * t).
 * Réutilisée à l'identique côté client (`Crash.tsx`) pour l'animation entre deux
 * sondages — ne pas modifier l'une sans l'autre. À 0.10, le 2x tombe vers 6.9s,
 * le 10x vers 23s : ralenti par rapport à la version initiale (0.13), pour
 * laisser plus de temps à la transition rouge -> vert de laisser espérer un
 * meilleur multiplicateur avant de se retirer.
 */
const GROWTH_PER_SECOND = 0.1;

/**
 * Avantage de la maison. Le point de crash est tiré via CP = max(1, (1-e)/u)
 * avec u uniforme sur (0, 1] : pour tout multiplicateur cible x >= 1, la
 * probabilité que la manche l'atteigne est exactement (1-e)/x, donc l'espérance
 * de gain d'un retrait à x est (1-e)/x * x = (1-e) quel que soit x — RTP fixe de
 * 96%, indépendant de la stratégie du joueur (avant l'arrondi entier du SP, qui
 * ajoute une toute petite marge supplémentaire côté maison, même remarque que
 * pour le 3:2 du blackjack).
 */
const HOUSE_EDGE = 0.04;
export const CRASH_RTP_PERCENT = 96;

function multiplierAt(elapsedSeconds: number): number {
  return Math.exp(GROWTH_PER_SECOND * Math.max(0, elapsedSeconds));
}

function drawCrashPointX100(): number {
  const u = 1 - Math.random(); // (0, 1], évite la division par zéro de Math.random() === 0
  const point = Math.max(1, (1 - HOUSE_EDGE) / u);
  return Math.round(point * 100);
}

function isOlderThan(ts: string | null, seconds: number): boolean {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > seconds * 1000;
}

function toPublicView(round: CrashRoundRow, bets: CrashBetEntry[]): CrashRoundPublicView {
  return {
    ...round,
    crash_point_x100: round.status === 'crashed' ? round.crash_point_x100 : null,
    bets,
  };
}

async function getLatestRoundRow(seasonId: number | null): Promise<CrashRoundRow | null> {
  const { rows } = await pool.query<CrashRoundRow>(
    `SELECT * FROM crash_rounds
     WHERE season_id IS NOT DISTINCT FROM $1
     ORDER BY created_at DESC LIMIT 1`,
    [seasonId]
  );
  return rows[0] ?? null;
}

async function createRound(seasonId: number | null): Promise<CrashRoundRow> {
  const { rows } = await pool.query<CrashRoundRow>(
    'INSERT INTO crash_rounds (season_id, crash_point_x100) VALUES ($1, $2) RETURNING *',
    [seasonId, drawCrashPointX100()]
  );
  return rows[0] as CrashRoundRow;
}

/** Interrupteur propre au crash (indépendant de `gambling_enabled`/`blackjack_enabled`). */
async function isCrashEnabled(): Promise<boolean> {
  return configService.getConfigBool('crash_enabled', false);
}

async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

async function listBets(roundId: number): Promise<CrashBetEntry[]> {
  const { rows } = await pool.query<Omit<CrashBetEntry, 'equipped_cosmetics'>>(
    `SELECT b.*, u.username, u.avatar_url
     FROM crash_bets b
     JOIN users u ON u.id = b.user_id
     WHERE b.round_id = $1
     ORDER BY b.joined_at ASC`,
    [roundId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}

/** Passe la manche `betting -> running` : fige `started_at` et calcule `crashed_at` à partir du point de crash déjà tiré. */
async function startRound(client: PoolClient, round: CrashRoundRow): Promise<CrashRoundRow> {
  const startedAt = new Date();
  const durationSeconds = Math.log(round.crash_point_x100 / 100) / GROWTH_PER_SECOND;
  const crashedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

  const { rows } = await client.query<CrashRoundRow>(
    `UPDATE crash_rounds SET status = 'running', started_at = $1, crashed_at = $2 WHERE id = $3 RETURNING *`,
    [startedAt, crashedAt, round.id]
  );
  return rows[0] as CrashRoundRow;
}

/** Marque perdues (sans crédit) les mises jamais retirées, passe la manche `crashed`. */
async function resolveRound(client: PoolClient, round: CrashRoundRow): Promise<CrashRoundRow> {
  await client.query(
    `UPDATE crash_bets SET resolved_at = NOW() WHERE round_id = $1 AND cashout_multiplier_x100 IS NULL`,
    [round.id]
  );
  const { rows } = await client.query<CrashRoundRow>(
    `UPDATE crash_rounds SET status = 'crashed' WHERE id = $1 RETURNING *`,
    [round.id]
  );
  return rows[0] as CrashRoundRow;
}

/**
 * Avance l'état de la manche si le temps est écoulé : démarrage (betting -> running)
 * une fois `starts_at` dépassé, puis résolution (running -> crashed) dès que
 * `crashed_at` est dépassé. Appelée avec une manche déjà verrouillée (`FOR UPDATE`)
 * par l'appelant.
 */
async function advanceRound(client: PoolClient, round: CrashRoundRow): Promise<CrashRoundRow> {
  let current = round;

  if (current.status === 'betting' && current.starts_at && new Date(current.starts_at) <= new Date()) {
    current = await startRound(client, current);
  }

  if (current.status === 'running' && current.crashed_at && new Date(current.crashed_at) <= new Date()) {
    current = await resolveRound(client, current);
  }

  return current;
}

async function syncRound(roundId: number): Promise<CrashRoundRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<CrashRoundRow>(
      'SELECT * FROM crash_rounds WHERE id = $1 FOR UPDATE',
      [roundId]
    );
    let round = rows[0];
    if (!round) {
      throw Object.assign(new Error('Manche introuvable'), { status: 404 });
    }
    round = await advanceRound(client, round);
    await client.query('COMMIT');
    return round;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getCurrentRoundView(
  userId: number,
  seasonId: number | null
): Promise<CrashActionResult> {
  let latest = await getLatestRoundRow(seasonId);
  if (!latest || (latest.status === 'crashed' && isOlderThan(latest.crashed_at, RESULTS_DISPLAY_SECONDS))) {
    latest = await createRound(seasonId);
  }

  const round = await syncRound(latest.id);
  const bets = await listBets(round.id);
  const [balance, enabled] = await Promise.all([getBalance(userId), isCrashEnabled()]);
  return { round: toPublicView(round, bets), balance, enabled };
}

/**
 * Place une mise sur la manche courante. Pas de `roundId` en entrée : le serveur
 * résout toujours "la" manche courante lui-même, pour éviter qu'un client mise
 * sur une manche déjà périmée côté UI.
 */
export async function placeBet(
  userId: number,
  betAmount: number,
  seasonId: number | null
): Promise<CrashActionResult> {
  const enabled = await isCrashEnabled();
  if (!enabled) {
    throw Object.assign(new Error('Le crash est désactivé par le MSP'), { status: 403 });
  }
  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  let latest = await getLatestRoundRow(seasonId);
  if (!latest || (latest.status === 'crashed' && isOlderThan(latest.crashed_at, RESULTS_DISPLAY_SECONDS))) {
    latest = await createRound(seasonId);
  }
  latest = await syncRound(latest.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: roundRows } = await client.query<CrashRoundRow>(
      'SELECT * FROM crash_rounds WHERE id = $1 FOR UPDATE',
      [latest.id]
    );
    const round = roundRows[0];
    if (!round || round.status !== 'betting') {
      throw Object.assign(
        new Error('La manche a déjà démarré, réessaie à la prochaine manche'),
        { status: 409 }
      );
    }

    const { rows: existingRows } = await client.query(
      'SELECT id FROM crash_bets WHERE round_id = $1 AND user_id = $2',
      [round.id, userId]
    );
    if (existingRows.length > 0) {
      throw Object.assign(new Error('Tu as déjà misé sur cette manche'), { status: 400 });
    }

    const { rows: spentRows } = await client.query<{ spent: string | null }>(
      `SELECT SUM(-amount) AS spent FROM sp_transactions
       WHERE user_id = $1 AND type = 'gambling_spend' AND created_at >= $2`,
      [userId, startOfDayLocalAsUTC()]
    );
    const spentToday = Number(spentRows[0]?.spent ?? 0);
    if (spentToday + betAmount > maxWagerPerDay) {
      throw Object.assign(
        new Error(
          `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
        ),
        { status: 400 }
      );
    }

    const { rows: betRows } = await client.query<CrashBetRow>(
      'INSERT INTO crash_bets (round_id, user_id, bet_amount) VALUES ($1, $2, $3) RETURNING *',
      [round.id, userId, betAmount]
    );
    const bet = betRows[0] as CrashBetRow;

    const betTx = await spService.debitSP({
      userId,
      amount: betAmount,
      type: 'gambling_spend',
      seasonId: round.season_id,
      relatedId: bet.id,
      note: `Mise crash (${betAmount} SP)`,
      client,
    });
    await client.query('UPDATE crash_bets SET bet_transaction_id = $1 WHERE id = $2', [
      betTx.id,
      bet.id,
    ]);

    let updatedRound = round;
    if (!round.starts_at) {
      const { rows: startRows } = await client.query<CrashRoundRow>(
        `UPDATE crash_rounds SET starts_at = NOW() + ($1 || ' seconds')::interval WHERE id = $2 RETURNING *`,
        [String(BETTING_WINDOW_SECONDS), round.id]
      );
      updatedRound = startRows[0] as CrashRoundRow;
    }

    const { rows: balanceRows } = await client.query<{ sp_balance: number }>(
      'SELECT sp_balance FROM users WHERE id = $1',
      [userId]
    );
    const balance = balanceRows[0]?.sp_balance ?? 0;

    await client.query('COMMIT');

    const bets = await listBets(updatedRound.id);
    return { round: toPublicView(updatedRound, bets), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function cashOut(
  userId: number,
  seasonId: number | null
): Promise<CrashActionResult> {
  const latestRow = await getLatestRoundRow(seasonId);
  if (!latestRow) {
    throw Object.assign(new Error('Aucune manche en cours'), { status: 404 });
  }
  const latest = await syncRound(latestRow.id);
  const enabled = await isCrashEnabled();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: roundRows } = await client.query<CrashRoundRow>(
      'SELECT * FROM crash_rounds WHERE id = $1 FOR UPDATE',
      [latest.id]
    );
    const round = roundRows[0];
    if (!round || round.status !== 'running') {
      throw Object.assign(new Error('Impossible de te retirer maintenant'), { status: 409 });
    }

    const { rows: betRows } = await client.query<CrashBetRow>(
      'SELECT * FROM crash_bets WHERE round_id = $1 AND user_id = $2 FOR UPDATE',
      [round.id, userId]
    );
    const bet = betRows[0];
    if (!bet) {
      throw Object.assign(new Error("Tu n'as pas misé sur cette manche"), { status: 404 });
    }
    if (bet.cashout_multiplier_x100 !== null) {
      throw Object.assign(new Error("Tu t'es déjà retiré"), { status: 409 });
    }

    const elapsedSeconds = (Date.now() - new Date(round.started_at as string).getTime()) / 1000;
    const rawMultiplierX100 = Math.round(multiplierAt(elapsedSeconds) * 100);
    // Le retrait ne peut jamais dépasser le point de crash : si la manche n'a
    // pas encore été détectée comme crashée (entre l'avancée d'état et ce calcul,
    // le temps réel peut avoir légèrement dépassé crashed_at), on plafonne quand
    // même au point de crash exact plutôt que de payer plus.
    const multiplierX100 = Math.min(rawMultiplierX100, round.crash_point_x100);
    const payout = Math.floor((bet.bet_amount * multiplierX100) / 100);

    await client.query(
      'UPDATE crash_bets SET cashout_multiplier_x100 = $1, resolved_at = NOW() WHERE id = $2',
      [multiplierX100, bet.id]
    );

    const payoutTx = await spService.creditSP({
      userId,
      amount: payout,
      type: 'gambling_win',
      seasonId: round.season_id,
      relatedId: bet.id,
      note: `Crash — Retrait à ${(multiplierX100 / 100).toFixed(2)}x (mise ${bet.bet_amount} SP)`,
      client,
    });
    await client.query('UPDATE crash_bets SET payout_transaction_id = $1 WHERE id = $2', [
      payoutTx.id,
      bet.id,
    ]);

    const { rows: balanceRows } = await client.query<{ sp_balance: number }>(
      'SELECT sp_balance FROM users WHERE id = $1',
      [userId]
    );
    const balance = balanceRows[0]?.sp_balance ?? 0;

    await client.query('COMMIT');

    const bets = await listBets(round.id);
    return { round: toPublicView(round, bets), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyHistory(userId: number, limit: number): Promise<CrashHistoryEntry[]> {
  const { rows } = await pool.query<CrashHistoryEntry>(
    `SELECT b.id, b.round_id, b.bet_amount, b.cashout_multiplier_x100, b.resolved_at, r.crash_point_x100
     FROM crash_bets b
     JOIN crash_rounds r ON r.id = b.round_id
     WHERE b.user_id = $1 AND b.resolved_at IS NOT NULL
     ORDER BY b.resolved_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
