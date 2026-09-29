import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  RouletteBet,
  RouletteBetEntry,
  RouletteBetType,
  RouletteHistoryEntry,
  RouletteRecentNumber,
  RoulettePayoutInfo,
  RouletteActionResult,
  RouletteRoundPublicView,
  RouletteRoundRow,
} from '../types.js';

/**
 * Roulette européenne à zéro unique : RTP mathématiquement identique pour
 * chaque type de pari (36/37 ≈ 97.3%) — pas de règle "en prison"/partage,
 * volontairement absente pour garder la mécanique simple.
 */
export const ROULETTE_RTP_PERCENT = 97;

/** Fenêtre de mise commune à tous les joueurs, déclenchée par la 1ère mise (même principe que Blackjack : une table vide ne fait pas tourner de compte à rebours). */
const BETTING_WINDOW_SECONDS = 10;
/** Durée de l'animation de la roue, identique pour tous les joueurs (spin_ends_at est un horodatage serveur, pas un délai client). */
const SPIN_DURATION_SECONDS = 4;
/** Délai pendant lequel une manche `finished` reste affichée avant qu'une nouvelle `betting` la remplace. */
const RESULTS_DISPLAY_SECONDS = 6;

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const BET_PAYOUTS_X100: Record<RouletteBetType, number> = {
  straight: 3600,
  red: 200,
  black: 200,
  odd: 200,
  even: 200,
  low: 200,
  high: 200,
  dozen1: 300,
  dozen2: 300,
  dozen3: 300,
  col1: 300,
  col2: 300,
  col3: 300,
};

const BET_LABELS: Record<RouletteBetType, string> = {
  straight: 'Numéro plein',
  red: 'Rouge',
  black: 'Noir',
  odd: 'Impair',
  even: 'Pair',
  low: 'Manque (1-18)',
  high: 'Passe (19-36)',
  dozen1: '1ère douzaine (1-12)',
  dozen2: '2ème douzaine (13-24)',
  dozen3: '3ème douzaine (25-36)',
  col1: 'Colonne 1',
  col2: 'Colonne 2',
  col3: 'Colonne 3',
};

const VALID_BET_TYPES = new Set<RouletteBetType>(Object.keys(BET_PAYOUTS_X100) as RouletteBetType[]);

export function listPayouts(): RoulettePayoutInfo[] {
  return (Object.keys(BET_PAYOUTS_X100) as RouletteBetType[]).map((type) => ({
    type,
    label: BET_LABELS[type],
    multiplier_x100: BET_PAYOUTS_X100[type],
  }));
}

async function isRouletteEnabled(): Promise<boolean> {
  return configService.getConfigBool('roulette_enabled', false);
}

async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

function isOlderThan(ts: string | null, seconds: number): boolean {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > seconds * 1000;
}

function validateBets(bets: unknown): RouletteBet[] {
  if (!Array.isArray(bets) || bets.length === 0) {
    throw Object.assign(new Error('Aucun pari posé'), { status: 400 });
  }
  return bets.map((raw) => {
    const type = (raw as { type?: unknown })?.type;
    const number = (raw as { number?: unknown })?.number;
    const amount = (raw as { amount?: unknown })?.amount;

    if (typeof type !== 'string' || !VALID_BET_TYPES.has(type as RouletteBetType)) {
      throw Object.assign(new Error('Type de pari invalide'), { status: 400 });
    }
    if (!Number.isInteger(amount) || (amount as number) <= 0) {
      throw Object.assign(new Error('Le montant d\'un pari doit être un entier positif'), { status: 400 });
    }
    if (type === 'straight') {
      if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 36) {
        throw Object.assign(new Error('Un pari plein doit cibler un numéro entre 0 et 36'), {
          status: 400,
        });
      }
      return { type: type as RouletteBetType, number: number as number, amount: amount as number };
    }
    return { type: type as RouletteBetType, number: null, amount: amount as number };
  });
}

function numberColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/** Gain total (mise incluse) d'un pari donné pour un numéro gagnant — 0 si perdant. */
function resolveBetPayout(bet: { type: RouletteBetType; number: number | null; amount: number }, winningNumber: number): number {
  const multiplier = BET_PAYOUTS_X100[bet.type];
  const wins = (() => {
    switch (bet.type) {
      case 'straight':
        return bet.number === winningNumber;
      case 'red':
        return numberColor(winningNumber) === 'red';
      case 'black':
        return numberColor(winningNumber) === 'black';
      case 'odd':
        return winningNumber !== 0 && winningNumber % 2 === 1;
      case 'even':
        return winningNumber !== 0 && winningNumber % 2 === 0;
      case 'low':
        return winningNumber >= 1 && winningNumber <= 18;
      case 'high':
        return winningNumber >= 19 && winningNumber <= 36;
      case 'dozen1':
        return winningNumber >= 1 && winningNumber <= 12;
      case 'dozen2':
        return winningNumber >= 13 && winningNumber <= 24;
      case 'dozen3':
        return winningNumber >= 25 && winningNumber <= 36;
      case 'col1':
        return winningNumber !== 0 && winningNumber % 3 === 1;
      case 'col2':
        return winningNumber !== 0 && winningNumber % 3 === 2;
      case 'col3':
        return winningNumber !== 0 && winningNumber % 3 === 0;
      default:
        return false;
    }
  })();
  return wins ? Math.floor((bet.amount * multiplier) / 100) : 0;
}

function toPublicView(round: RouletteRoundRow, bets: RouletteBetEntry[]): RouletteRoundPublicView {
  return {
    ...round,
    // Tiré dès la création de la manche : caché tant que les mises sont ouvertes, révélé dès `spinning`
    // (placeBet refuse toute mise hors `betting` sous verrou) pour que la roue vise la bonne case dès son lancement.
    winning_number: round.status === 'betting' ? null : round.winning_number,
    bets,
  };
}

async function getLatestRoundRow(seasonId: number | null): Promise<RouletteRoundRow | null> {
  const { rows } = await pool.query<RouletteRoundRow>(
    `SELECT * FROM roulette_rounds
     WHERE season_id IS NOT DISTINCT FROM $1
     ORDER BY created_at DESC LIMIT 1`,
    [seasonId]
  );
  return rows[0] ?? null;
}

async function createRound(seasonId: number | null): Promise<RouletteRoundRow> {
  const winningNumber = Math.floor(Math.random() * 37);
  const { rows } = await pool.query<RouletteRoundRow>(
    'INSERT INTO roulette_rounds (season_id, winning_number) VALUES ($1, $2) RETURNING *',
    [seasonId, winningNumber]
  );
  return rows[0] as RouletteRoundRow;
}

async function listRoundBets(roundId: number): Promise<RouletteBetEntry[]> {
  const { rows } = await pool.query<Omit<RouletteBetEntry, 'equipped_cosmetics'>>(
    `SELECT b.*, u.username, u.avatar_url
     FROM roulette_bets b
     JOIN users u ON u.id = b.user_id
     WHERE b.round_id = $1
     ORDER BY b.created_at ASC`,
    [roundId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({ ...row, equipped_cosmetics: equippedByUser.get(row.user_id) ?? [] }));
}

/**
 * Règle tous les paris de la manche (verrouillés), crédite les gains, puis
 * passe la manche `finished`. Appelée avec une manche déjà verrouillée
 * (`FOR UPDATE`) par l'appelant — même contrat que resolveRound côté
 * Blackjack.
 */
async function resolveRound(client: PoolClient, round: RouletteRoundRow): Promise<RouletteRoundRow> {
  const { rows: bets } = await client.query<{ id: number; user_id: number; type: RouletteBetType; number: number | null; amount: number }>(
    'SELECT * FROM roulette_bets WHERE round_id = $1 FOR UPDATE',
    [round.id]
  );

  for (const bet of bets) {
    const payout = resolveBetPayout(bet, round.winning_number as number);
    let payoutTransactionId: number | null = null;
    if (payout > 0) {
      const tx = await spService.creditSP({
        userId: bet.user_id,
        amount: payout,
        type: 'gambling_win',
        seasonId: round.season_id,
        relatedId: bet.id,
        note: `Roulette — numéro ${round.winning_number} (mise ${bet.amount} SP)`,
        client,
      });
      payoutTransactionId = tx.id;
    }
    await client.query('UPDATE roulette_bets SET payout = $1, payout_transaction_id = $2 WHERE id = $3', [
      payout,
      payoutTransactionId,
      bet.id,
    ]);
  }

  const { rows } = await client.query<RouletteRoundRow>(
    `UPDATE roulette_rounds SET status = 'finished', finished_at = NOW() WHERE id = $1 RETURNING *`,
    [round.id]
  );
  return rows[0] as RouletteRoundRow;
}

/**
 * Avance l'état de la manche si le temps est écoulé : ouverture des mises ->
 * lancement de la roue (`starts_at` dépassé), puis lancement -> résolution
 * (`spin_ends_at` dépassé). Appelée avec une manche déjà verrouillée
 * (`FOR UPDATE`) par l'appelant. Même pattern que advanceSession
 * (blackjack.service.ts) / advanceRound (crash.service.ts) — état avancé "à
 * la lecture", pas de cron.
 */
async function advanceRound(client: PoolClient, round: RouletteRoundRow): Promise<RouletteRoundRow> {
  let current = round;

  if (current.status === 'betting' && current.starts_at && new Date(current.starts_at) <= new Date()) {
    const { rows } = await client.query<RouletteRoundRow>(
      `UPDATE roulette_rounds SET status = 'spinning', spin_ends_at = NOW() + ($1 || ' seconds')::interval WHERE id = $2 RETURNING *`,
      [String(SPIN_DURATION_SECONDS), current.id]
    );
    current = rows[0] as RouletteRoundRow;
  }

  if (current.status === 'spinning' && current.spin_ends_at && new Date(current.spin_ends_at) <= new Date()) {
    current = await resolveRound(client, current);
  }

  return current;
}

async function syncRound(roundId: number): Promise<RouletteRoundRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<RouletteRoundRow>(
      'SELECT * FROM roulette_rounds WHERE id = $1 FOR UPDATE',
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

async function resolveCurrentRound(seasonId: number | null): Promise<RouletteRoundRow> {
  let latest = await getLatestRoundRow(seasonId);
  if (!latest || (latest.status === 'finished' && isOlderThan(latest.finished_at, RESULTS_DISPLAY_SECONDS))) {
    latest = await createRound(seasonId);
  }
  return syncRound(latest.id);
}

export async function getCurrentRoundView(
  userId: number,
  seasonId: number | null
): Promise<RouletteActionResult> {
  const round = await resolveCurrentRound(seasonId);
  const bets = await listRoundBets(round.id);
  const [balance, enabled] = await Promise.all([getBalance(userId), isRouletteEnabled()]);
  return { round: toPublicView(round, bets), balance, enabled };
}

/**
 * Pose un ou plusieurs paris sur la manche courante. Pas de `roundId` en
 * entrée : le serveur résout toujours "la" manche courante lui-même, pour
 * éviter qu'un client mise sur une table déjà périmée côté UI (même
 * principe que joinSession côté Blackjack).
 */
export async function placeBet(
  userId: number,
  betsInput: unknown,
  seasonId: number | null
): Promise<RouletteActionResult> {
  const enabled = await isRouletteEnabled();
  if (!enabled) {
    throw Object.assign(new Error('La Roulette est désactivée par le MSP'), { status: 403 });
  }
  const bets = validateBets(betsInput);
  const totalWager = bets.reduce((sum, b) => sum + b.amount, 0);
  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  const latest = await resolveCurrentRound(seasonId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: roundRows } = await client.query<RouletteRoundRow>(
      'SELECT * FROM roulette_rounds WHERE id = $1 FOR UPDATE',
      [latest.id]
    );
    const round = roundRows[0];
    if (!round || round.status !== 'betting') {
      throw Object.assign(new Error('Les mises sont closes, le prochain tour arrive'), { status: 409 });
    }

    const { rows: spentRows } = await client.query<{ spent: string | null }>(
      `SELECT SUM(-amount) AS spent FROM sp_transactions
       WHERE user_id = $1 AND type = 'gambling_spend' AND created_at >= $2`,
      [userId, startOfDayLocalAsUTC()]
    );
    const spentToday = Number(spentRows[0]?.spent ?? 0);
    if (spentToday + totalWager > maxWagerPerDay) {
      throw Object.assign(
        new Error(
          `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
        ),
        { status: 400 }
      );
    }

    const { rows: countRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) FROM roulette_bets WHERE round_id = $1',
      [round.id]
    );
    const isFirstBetAtTable = Number(countRows[0]?.count ?? 0) === 0;

    for (const bet of bets) {
      const { rows: betRows } = await client.query<{ id: number }>(
        `INSERT INTO roulette_bets (round_id, user_id, type, number, amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (round_id, user_id, type, COALESCE(number, -1))
         DO UPDATE SET amount = roulette_bets.amount + EXCLUDED.amount
         RETURNING id`,
        [round.id, userId, bet.type, bet.number, bet.amount]
      );
      const betRow = betRows[0] as { id: number };

      const betTx = await spService.debitSP({
        userId,
        amount: bet.amount,
        type: 'gambling_spend',
        seasonId: round.season_id,
        relatedId: betRow.id,
        note: `Mise Roulette (${BET_LABELS[bet.type]}${bet.type === 'straight' ? ` ${bet.number}` : ''}, ${bet.amount} SP)`,
        client,
      });
      await client.query('UPDATE roulette_bets SET bet_transaction_id = $1 WHERE id = $2', [
        betTx.id,
        betRow.id,
      ]);
    }

    let updatedRound = round;
    if (isFirstBetAtTable) {
      const { rows } = await client.query<RouletteRoundRow>(
        `UPDATE roulette_rounds SET starts_at = NOW() + ($1 || ' seconds')::interval WHERE id = $2 RETURNING *`,
        [String(BETTING_WINDOW_SECONDS), round.id]
      );
      updatedRound = rows[0] as RouletteRoundRow;
    }

    const balance = await getBalance(userId);
    await client.query('COMMIT');

    const betEntries = await listRoundBets(updatedRound.id);
    return { round: toPublicView(updatedRound, betEntries), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listHistory(
  limit: number,
  userId: number | null = null
): Promise<RouletteHistoryEntry[]> {
  const { rows } = await pool.query<
    Omit<RouletteBetEntry, 'equipped_cosmetics'> & { winning_number: number }
  >(
    `SELECT b.*, r.winning_number, u.username, u.avatar_url
     FROM roulette_bets b
     JOIN roulette_rounds r ON r.id = b.round_id AND r.status = 'finished'
     JOIN users u ON u.id = b.user_id
     WHERE ($1::int IS NULL OR b.user_id = $1)
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({ ...row, equipped_cosmetics: equippedByUser.get(row.user_id) ?? [] }));
}

/** Derniers numéros tirés (manches `finished`, toutes saisons), du plus récent au plus ancien — bandeau au-dessus de la roue. */
export async function listRecentNumbers(limit: number): Promise<RouletteRecentNumber[]> {
  const { rows } = await pool.query<RouletteRecentNumber>(
    `SELECT id, winning_number FROM roulette_rounds WHERE status = 'finished' ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
