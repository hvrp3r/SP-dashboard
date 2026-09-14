import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  RouletteBet,
  RouletteBetType,
  RouletteHistoryEntry,
  RoulettePayoutInfo,
  RouletteRoundRow,
  RouletteSpinResult,
} from '../types.js';

/**
 * Roulette européenne à zéro unique : RTP mathématiquement identique pour
 * chaque type de pari (36/37 ≈ 97.3%), contrairement au Tower/Crash dont le
 * RTP est calibré à la main — même raisonnement que pour n'importe quelle
 * roulette casino sans règle "en prison"/partage (volontairement absente ici,
 * pour garder la mécanique simple).
 */
export const ROULETTE_RTP_PERCENT = 97;

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Retour total (x100, mise incluse) pour chaque type de pari. */
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

/** Lève une erreur 400 si le tableau de paris est mal formé — jamais fait confiance au client au-delà de ça (le règlement recalcule tout côté serveur). */
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
    return { type: type as RouletteBetType, amount: amount as number };
  });
}

function numberColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/** Gain total (mise incluse) d'un pari donné pour un numéro gagnant — 0 si perdant. */
function resolveBetPayout(bet: RouletteBet, winningNumber: number): number {
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

export async function spin(
  userId: number,
  betsInput: unknown,
  seasonId: number | null
): Promise<RouletteSpinResult> {
  const enabled = await isRouletteEnabled();
  if (!enabled) {
    throw Object.assign(new Error('La Roulette est désactivée par le MSP'), { status: 403 });
  }

  const bets = validateBets(betsInput);
  const totalWager = bets.reduce((sum, b) => sum + b.amount, 0);
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
    if (spentToday + totalWager > maxWagerPerDay) {
      throw Object.assign(
        new Error(
          `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
        ),
        { status: 400 }
      );
    }

    const winningNumber = Math.floor(Math.random() * 37);
    const settledBets: RouletteBet[] = bets.map((bet) => ({
      ...bet,
      payout: resolveBetPayout(bet, winningNumber),
    }));
    const totalPayout = settledBets.reduce((sum, b) => sum + (b.payout ?? 0), 0);

    const { rows: roundRows } = await client.query<RouletteRoundRow>(
      `INSERT INTO roulette_rounds (user_id, season_id, bets, winning_number, total_wager, total_payout)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, seasonId, JSON.stringify(settledBets), winningNumber, totalWager, totalPayout]
    );
    const round = roundRows[0] as RouletteRoundRow;

    const betTx = await spService.debitSP({
      userId,
      amount: totalWager,
      type: 'gambling_spend',
      seasonId,
      relatedId: round.id,
      note: `Mise Roulette (${bets.length} pari${bets.length > 1 ? 's' : ''}, ${totalWager} SP)`,
      client,
    });
    round.bet_transaction_id = betTx.id;

    if (totalPayout > 0) {
      const payoutTx = await spService.creditSP({
        userId,
        amount: totalPayout,
        type: 'gambling_win',
        seasonId,
        relatedId: round.id,
        note: `Roulette — numéro ${winningNumber} (mise ${totalWager} SP)`,
        client,
      });
      round.payout_transaction_id = payoutTx.id;
    }

    await client.query(
      `UPDATE roulette_rounds SET bet_transaction_id = $1, payout_transaction_id = $2 WHERE id = $3`,
      [round.bet_transaction_id, round.payout_transaction_id, round.id]
    );

    const balance = await getBalance(userId);
    await client.query('COMMIT');

    return { round, balance, enabled };
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
  const { rows } = await pool.query<RouletteRoundRow & { username: string; avatar_url: string | null }>(
    `SELECT r.*, u.username, u.avatar_url
     FROM roulette_rounds r
     JOIN users u ON u.id = r.user_id
     WHERE ($1::int IS NULL OR r.user_id = $1)
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((round) => ({
    id: round.id,
    user_id: round.user_id,
    bets: round.bets,
    winning_number: round.winning_number,
    total_wager: round.total_wager,
    total_payout: round.total_payout,
    created_at: round.created_at,
    username: round.username,
    avatar_url: round.avatar_url,
    equipped_cosmetics: equippedByUser.get(round.user_id) ?? [],
  }));
}
