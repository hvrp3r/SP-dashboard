import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  SlotHistoryEntry,
  SlotSpinResult,
  SlotSpinRow,
  SlotSymbolInfo,
  SlotSymbolKey,
  SlotWinTier,
} from '../types.js';

/**
 * Avantage de la maison de 4% — même valeur que Crash/Tower (CRASH_RTP_PERCENT
 * / TOWER_RTP_PERCENT) : RTP fixe câblé dans le code, non configurable par le
 * MSP. Contrairement à Crash/Tower dont le multiplicateur est continu (formule
 * appliquée à chaque pari), ici le RTP est calibré une seule fois hors-ligne
 * par énumération exacte des 8^3 = 512 combinaisons possibles à partir des
 * poids/multiplicateurs figés ci-dessous (script de calibration, pas de
 * simulation) : straw≈24.4%, wood≈22.5%, brick≈19.5%, pig≈15.9%, wolf≈5.2%,
 * house≈4.5%, gem≈2.0%, wild(triple)≈0.7% de contribution à l'espérance de
 * gain, pour un total de 95.99% ≈ 96%.
 */
export const SLOTS_RTP_PERCENT = 96;

const REEL_COUNT = 3;

/**
 * Un seul payline (les 3 rouleaux). Poids de tirage identiques sur les 3
 * rouleaux. `wild` se substitue à n'importe quel symbole (y compris `gem`, le
 * jackpot) pour compléter un triple. Les 4 symboles de bas étage (matériaux
 * des maisons + cochon) paient aussi sur un simple doublé — les symboles
 * rares (loup/maison/wild/gem) ne paient que sur un triple complet, pour
 * garder les gros gains rares. mult3/mult2 en x100 (même convention que
 * crash_point_x100 / tower multipliers_x100).
 */
interface SlotSymbolDef {
  key: SlotSymbolKey;
  weight: number;
  mult3X100: number;
  mult2X100: number | null;
}

const SLOT_SYMBOLS: SlotSymbolDef[] = [
  { key: 'straw', weight: 280, mult3X100: 270, mult2X100: 100 },
  { key: 'wood', weight: 220, mult3X100: 380, mult2X100: 150 },
  { key: 'brick', weight: 170, mult3X100: 600, mult2X100: 200 },
  { key: 'pig', weight: 120, mult3X100: 1150, mult2X100: 300 },
  { key: 'wolf', weight: 90, mult3X100: 2200, mult2X100: null },
  { key: 'house', weight: 60, mult3X100: 4200, mult2X100: null },
  { key: 'wild', weight: 45, mult3X100: 8000, mult2X100: null },
  { key: 'gem', weight: 15, mult3X100: 16000, mult2X100: null },
];

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

function symbolDef(key: SlotSymbolKey): SlotSymbolDef {
  return SLOT_SYMBOLS.find((s) => s.key === key) as SlotSymbolDef;
}

/** Registre public des symboles (paytable) — poids, probabilité par rouleau, multiplicateurs. */
export function listPaytable(): SlotSymbolInfo[] {
  return SLOT_SYMBOLS.map((s) => ({
    key: s.key,
    weight: s.weight,
    probability: s.weight / TOTAL_WEIGHT,
    mult3_x100: s.mult3X100,
    mult2_x100: s.mult2X100,
  }));
}

/** Tirage pondéré d'un symbole, jamais côté client — même principe que le tirage des caisses gambling. */
function drawSymbol(): SlotSymbolKey {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SLOT_SYMBOLS) {
    r -= s.weight;
    if (r < 0) return s.key;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]!.key;
}

function drawReels(): SlotSymbolKey[] {
  return Array.from({ length: REEL_COUNT }, () => drawSymbol());
}

/**
 * Résout le résultat d'un tirage : cherche d'abord un triple (avec
 * substitution wild, y compris trois wilds), sinon un doublé pour un symbole
 * de bas étage — mais seulement si aucun wild n'est présent (un wild dans le
 * lot ferait déjà gagner le triple correspondant, un meilleur payout).
 */
function resolveWin(
  reels: SlotSymbolKey[]
): { symbol: SlotSymbolKey; tier: SlotWinTier; multX100: number } | null {
  const wildCount = reels.filter((r) => r === 'wild').length;
  const nonWild = reels.filter((r) => r !== 'wild');
  const distinctNonWild = new Set(nonWild);

  if (wildCount === REEL_COUNT) {
    const wild = symbolDef('wild');
    return { symbol: 'wild', tier: 'triple', multX100: wild.mult3X100 };
  }
  if (distinctNonWild.size === 1) {
    const key = [...distinctNonWild][0] as SlotSymbolKey;
    const def = symbolDef(key);
    return { symbol: key, tier: 'triple', multX100: def.mult3X100 };
  }

  if (wildCount === 0) {
    for (const s of SLOT_SYMBOLS) {
      if (s.mult2X100 === null) continue;
      const count = reels.filter((r) => r === s.key).length;
      if (count === 2) {
        return { symbol: s.key, tier: 'double', multX100: s.mult2X100 };
      }
    }
  }

  return null;
}

async function isSlotsEnabled(): Promise<boolean> {
  return configService.getConfigBool('slots_enabled', false);
}

async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

export async function getStatus(userId: number): Promise<{ balance: number; enabled: boolean }> {
  const [balance, enabled] = await Promise.all([getBalance(userId), isSlotsEnabled()]);
  return { balance, enabled };
}

export async function spin(
  userId: number,
  betAmount: number,
  seasonId: number | null
): Promise<SlotSpinResult> {
  const enabled = await isSlotsEnabled();
  if (!enabled) {
    throw Object.assign(new Error('La machine à sous est désactivée par le MSP'), { status: 403 });
  }
  if (!Number.isInteger(betAmount) || betAmount <= 0) {
    throw Object.assign(new Error('La mise doit être un entier positif'), { status: 400 });
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
    if (spentToday + betAmount > maxWagerPerDay) {
      throw Object.assign(
        new Error(
          `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
        ),
        { status: 400 }
      );
    }

    const betTx = await spService.debitSP({
      userId,
      amount: betAmount,
      type: 'gambling_spend',
      seasonId,
      note: `Mise machine à sous (${betAmount} SP)`,
      client,
    });

    const reels = drawReels();
    const win = resolveWin(reels);
    const payout = win ? Math.floor((betAmount * win.multX100) / 100) : 0;

    let payoutTxId: number | null = null;
    if (win && payout > 0) {
      const payoutTx = await spService.creditSP({
        userId,
        amount: payout,
        type: 'gambling_win',
        seasonId,
        note: `Machine à sous — ${win.tier === 'triple' ? 'triple' : 'doublé'} ${win.symbol} (mise ${betAmount} SP)`,
        client,
      });
      payoutTxId = payoutTx.id;
    }

    const { rows: spinRows } = await client.query<SlotSpinRow>(
      `INSERT INTO slot_spins
         (user_id, season_id, bet_amount, reels, win_symbol, win_tier, payout, bet_transaction_id, payout_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        seasonId,
        betAmount,
        JSON.stringify(reels),
        win?.symbol ?? null,
        win?.tier ?? null,
        payout,
        betTx.id,
        payoutTxId,
      ]
    );
    const spinRow = spinRows[0] as SlotSpinRow;

    const balance = await getBalance(userId);
    await client.query('COMMIT');

    return {
      reels: spinRow.reels,
      win_symbol: spinRow.win_symbol,
      win_tier: spinRow.win_tier,
      payout: spinRow.payout,
      balance,
      enabled,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Historique des spins — tous les joueurs par défaut (`userId = null`), ou
 * filtré sur un seul joueur. Même convention que blackjack/crash/tower
 * `listHistory` (jointure username/avatar/cosmétiques systématique).
 */
export async function listHistory(
  limit: number,
  userId: number | null = null
): Promise<SlotHistoryEntry[]> {
  const { rows } = await pool.query<SlotSpinRow & { username: string; avatar_url: string | null }>(
    `SELECT s.*, u.username, u.avatar_url
     FROM slot_spins s
     JOIN users u ON u.id = s.user_id
     WHERE ($1::int IS NULL OR s.user_id = $1)
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    bet_amount: row.bet_amount,
    reels: row.reels,
    win_symbol: row.win_symbol,
    win_tier: row.win_tier,
    payout: row.payout,
    created_at: row.created_at,
    username: row.username,
    avatar_url: row.avatar_url,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}
