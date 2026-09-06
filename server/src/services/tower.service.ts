import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import type {
  TowerActionResult,
  TowerDifficulty,
  TowerDifficultyInfo,
  TowerGamePublicView,
  TowerGameRow,
  TowerHistoryEntry,
} from '../types.js';

/**
 * Avantage de la maison — même valeur et même raisonnement que Crash
 * (CRASH_RTP_PERCENT dans crash.service.ts) : chaque étage est un pari
 * indépendant dont l'espérance de gain, à mise égale, vaut exactement
 * (1 - HOUSE_EDGE) fois la mise engagée sur cet étage, quel que soit le
 * nombre d'étages déjà franchis — RTP fixe de 96% indépendant du moment où
 * le joueur se retire (avant l'arrondi entier du SP à chaque étage, qui
 * ajoute une toute petite marge supplémentaire côté maison, cumulée à
 * chaque étage franchi).
 */
const HOUSE_EDGE = 0.04;
export const TOWER_RTP_PERCENT = 96;

/**
 * Même hauteur pour toutes les difficultés (décision explicite de
 * l'utilisateur — la tour ne doit pas paraître plus courte ou plus haute
 * selon la difficulté choisie) : seuls le nombre de cases/mines par étage
 * changent, ce qui fait varier le multiplicateur au sommet plutôt que le
 * nombre d'étages à franchir.
 */
const TOWER_FLOORS = 8;

/**
 * Nombre de cases et de mines par étage, fixes pour toute la hauteur d'une
 * difficulté donnée (`cells`/`mines` publics dès la création de la partie —
 * seule la position exacte des mines à chaque étage reste secrète). Le
 * "Moyen" utilise une grille à 2 cases (1 mine, 50/50) plutôt qu'une simple
 * variante de la grille à 3 cases — décision explicite de l'utilisateur.
 */
interface TowerDifficultyConfig {
  cells: number;
  mines: number;
  floors: number;
}

const TOWER_DIFFICULTIES: Record<TowerDifficulty, TowerDifficultyConfig> = {
  easy: { cells: 3, mines: 1, floors: TOWER_FLOORS },
  medium: { cells: 2, mines: 1, floors: TOWER_FLOORS },
  hard: { cells: 3, mines: 2, floors: TOWER_FLOORS },
};

function perLevelMultiplierX100(cfg: TowerDifficultyConfig): number {
  const surviveProb = (cfg.cells - cfg.mines) / cfg.cells;
  return Math.round(((1 - HOUSE_EDGE) / surviveProb) * 100);
}

/** `result[k]` = multiplicateur cumulé (x100) après avoir franchi k étages ; `result[0]` = 100 (x1.00). */
function buildCumulativeMultipliers(difficulty: TowerDifficulty): number[] {
  const cfg = TOWER_DIFFICULTIES[difficulty];
  const perLevel = perLevelMultiplierX100(cfg);
  const result: number[] = [100];
  let cumulative = 100;
  for (let i = 0; i < cfg.floors; i++) {
    cumulative = Math.round((cumulative * perLevel) / 100);
    result.push(cumulative);
  }
  return result;
}

const CUMULATIVE_MULTIPLIERS_X100: Record<TowerDifficulty, number[]> = {
  easy: buildCumulativeMultipliers('easy'),
  medium: buildCumulativeMultipliers('medium'),
  hard: buildCumulativeMultipliers('hard'),
};

function isValidDifficulty(value: unknown): value is TowerDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

/** Barème public (nombre de mines par étage) — identique à chaque étage pour une difficulté donnée. */
function minesScheduleFor(difficulty: TowerDifficulty): number[] {
  const cfg = TOWER_DIFFICULTIES[difficulty];
  return Array.from({ length: cfg.floors }, () => cfg.mines);
}

/** Tirage des positions minées, au hasard parmi les cases de l'étage (jamais côté client). */
function drawMinePositions(difficulty: TowerDifficulty): number[][] {
  const cfg = TOWER_DIFFICULTIES[difficulty];
  return Array.from({ length: cfg.floors }, () => {
    const cells = Array.from({ length: cfg.cells }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j] as number, cells[i] as number];
    }
    return cells.slice(0, cfg.mines).sort((a, b) => a - b);
  });
}

/** Registre public des difficultés — sert le sélecteur et l'aperçu de la tour avant la mise. */
export function listDifficulties(): TowerDifficultyInfo[] {
  return (Object.keys(TOWER_DIFFICULTIES) as TowerDifficulty[]).map((difficulty) => {
    const cfg = TOWER_DIFFICULTIES[difficulty];
    return {
      difficulty,
      floors: cfg.floors,
      cells_per_floor: cfg.cells,
      mines_per_floor: cfg.mines,
      multipliers_x100: CUMULATIVE_MULTIPLIERS_X100[difficulty] as number[],
    };
  });
}

async function isTowerEnabled(): Promise<boolean> {
  return configService.getConfigBool('tower_enabled', false);
}

async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

function toPublicView(game: TowerGameRow): TowerGamePublicView {
  const cfg = TOWER_DIFFICULTIES[game.difficulty];
  const cumulative = CUMULATIVE_MULTIPLIERS_X100[game.difficulty] as number[];
  const revealed = game.status !== 'in_progress';
  const currentMultiplierX100 = cumulative[game.current_level] as number;
  const payout =
    game.status === 'cashed_out'
      ? Math.floor((game.bet_amount * currentMultiplierX100) / 100)
      : game.status === 'busted'
        ? 0
        : null;

  return {
    ...game,
    mine_positions: game.mine_positions.map((mines, i) =>
      revealed || i < game.current_level ? mines : null
    ),
    total_floors: cfg.floors,
    cells_per_floor: cfg.cells,
    mines_per_floor: minesScheduleFor(game.difficulty),
    multipliers_x100: cumulative,
    current_multiplier_x100: currentMultiplierX100,
    next_multiplier_x100:
      game.status === 'in_progress' && game.current_level < cfg.floors
        ? (cumulative[game.current_level + 1] as number)
        : null,
    payout,
  };
}

async function getActiveGameRow(userId: number): Promise<TowerGameRow | null> {
  const { rows } = await pool.query<TowerGameRow>(
    `SELECT * FROM tower_games WHERE user_id = $1 AND status = 'in_progress' LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function getCurrentGameView(userId: number): Promise<TowerActionResult> {
  const [game, balance, enabled] = await Promise.all([
    getActiveGameRow(userId),
    getBalance(userId),
    isTowerEnabled(),
  ]);
  return { game: game ? toPublicView(game) : null, balance, enabled };
}

export async function startGame(
  userId: number,
  difficulty: TowerDifficulty,
  betAmount: number,
  seasonId: number | null
): Promise<TowerActionResult> {
  const enabled = await isTowerEnabled();
  if (!enabled) {
    throw Object.assign(new Error('Le Tower est désactivé par le MSP'), { status: 403 });
  }
  if (!isValidDifficulty(difficulty)) {
    throw Object.assign(new Error('Difficulté invalide'), { status: 400 });
  }
  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const existing = await client.query(
      `SELECT id FROM tower_games WHERE user_id = $1 AND status = 'in_progress'`,
      [userId]
    );
    if (existing.rows.length > 0) {
      throw Object.assign(new Error('Une partie de Tower est déjà en cours'), { status: 409 });
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

    const minePositions = drawMinePositions(difficulty);
    const { rows: gameRows } = await client.query<TowerGameRow>(
      `INSERT INTO tower_games (user_id, season_id, difficulty, bet_amount, mine_positions)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, seasonId, difficulty, betAmount, JSON.stringify(minePositions)]
    );
    const game = gameRows[0] as TowerGameRow;

    const betTx = await spService.debitSP({
      userId,
      amount: betAmount,
      type: 'gambling_spend',
      seasonId,
      relatedId: game.id,
      note: `Mise Tower (${difficulty}, ${betAmount} SP)`,
      client,
    });
    await client.query('UPDATE tower_games SET bet_transaction_id = $1 WHERE id = $2', [
      betTx.id,
      game.id,
    ]);
    game.bet_transaction_id = betTx.id;

    const balance = await getBalance(userId);
    await client.query('COMMIT');

    return { game: toPublicView(game), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function pickCell(userId: number, cell: number): Promise<TowerActionResult> {
  const enabled = await isTowerEnabled();
  if (!Number.isInteger(cell) || cell < 0) {
    throw Object.assign(new Error('Case invalide'), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: gameRows } = await client.query<TowerGameRow>(
      `SELECT * FROM tower_games WHERE user_id = $1 AND status = 'in_progress' FOR UPDATE`,
      [userId]
    );
    const game = gameRows[0];
    if (!game) {
      throw Object.assign(new Error('Aucune partie de Tower en cours'), { status: 404 });
    }

    const cfg = TOWER_DIFFICULTIES[game.difficulty];
    if (cell >= cfg.cells) {
      throw Object.assign(new Error('Case invalide'), { status: 400 });
    }
    const mines = game.mine_positions[game.current_level] ?? [];
    const busted = mines.includes(cell);

    let updated: TowerGameRow;
    if (busted) {
      const { rows } = await client.query<TowerGameRow>(
        `UPDATE tower_games
         SET status = 'busted', picks = picks || $1::jsonb, resolved_at = NOW()
         WHERE id = $2 RETURNING *`,
        [JSON.stringify([cell]), game.id]
      );
      updated = rows[0] as TowerGameRow;
    } else {
      const nextLevel = game.current_level + 1;
      const reachedTop = nextLevel >= cfg.floors;

      if (reachedTop) {
        const cumulative = CUMULATIVE_MULTIPLIERS_X100[game.difficulty] as number[];
        const payout = Math.floor((game.bet_amount * (cumulative[nextLevel] as number)) / 100);
        const payoutTx = await spService.creditSP({
          userId,
          amount: payout,
          type: 'gambling_win',
          seasonId: game.season_id,
          relatedId: game.id,
          note: `Tower — Sommet atteint (${game.difficulty}, mise ${game.bet_amount} SP)`,
          client,
        });
        const { rows } = await client.query<TowerGameRow>(
          `UPDATE tower_games
           SET status = 'cashed_out', current_level = $1, picks = picks || $2::jsonb,
               payout_transaction_id = $3, resolved_at = NOW()
           WHERE id = $4 RETURNING *`,
          [nextLevel, JSON.stringify([cell]), payoutTx.id, game.id]
        );
        updated = rows[0] as TowerGameRow;
      } else {
        const { rows } = await client.query<TowerGameRow>(
          `UPDATE tower_games
           SET current_level = $1, picks = picks || $2::jsonb
           WHERE id = $3 RETURNING *`,
          [nextLevel, JSON.stringify([cell]), game.id]
        );
        updated = rows[0] as TowerGameRow;
      }
    }

    const balance = await getBalance(userId);
    await client.query('COMMIT');

    return { game: toPublicView(updated), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function cashOut(userId: number): Promise<TowerActionResult> {
  const enabled = await isTowerEnabled();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: gameRows } = await client.query<TowerGameRow>(
      `SELECT * FROM tower_games WHERE user_id = $1 AND status = 'in_progress' FOR UPDATE`,
      [userId]
    );
    const game = gameRows[0];
    if (!game) {
      throw Object.assign(new Error('Aucune partie de Tower en cours'), { status: 404 });
    }
    if (game.current_level < 1) {
      throw Object.assign(
        new Error("Grimpe au moins un étage avant de te retirer"),
        { status: 400 }
      );
    }

    const cumulative = CUMULATIVE_MULTIPLIERS_X100[game.difficulty] as number[];
    const payout = Math.floor((game.bet_amount * (cumulative[game.current_level] as number)) / 100);

    const payoutTx = await spService.creditSP({
      userId,
      amount: payout,
      type: 'gambling_win',
      seasonId: game.season_id,
      relatedId: game.id,
      note: `Tower — Retrait à l'étage ${game.current_level} (${game.difficulty}, mise ${game.bet_amount} SP)`,
      client,
    });

    const { rows } = await client.query<TowerGameRow>(
      `UPDATE tower_games
       SET status = 'cashed_out', payout_transaction_id = $1, resolved_at = NOW()
       WHERE id = $2 RETURNING *`,
      [payoutTx.id, game.id]
    );
    const updated = rows[0] as TowerGameRow;

    const balance = await getBalance(userId);
    await client.query('COMMIT');

    return { game: toPublicView(updated), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Historique des parties terminées — toutes les parties de tous les joueurs
 * par défaut (`userId = null`), ou filtré sur un seul joueur. Toujours joint
 * username/avatar/cosmétiques équipés, même en mode "un seul joueur" — même
 * convention que blackjack/crash `listHistory`, pour un composant client unique.
 */
export async function listHistory(
  limit: number,
  userId: number | null = null
): Promise<TowerHistoryEntry[]> {
  const { rows } = await pool.query<TowerGameRow & { username: string; avatar_url: string | null }>(
    `SELECT g.*, u.username, u.avatar_url
     FROM tower_games g
     JOIN users u ON u.id = g.user_id
     WHERE g.status != 'in_progress' AND ($1::int IS NULL OR g.user_id = $1)
     ORDER BY g.resolved_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((game) => {
    const cfg = TOWER_DIFFICULTIES[game.difficulty];
    const cumulative = CUMULATIVE_MULTIPLIERS_X100[game.difficulty] as number[];
    const finalMultiplierX100 = cumulative[game.current_level] as number;
    return {
      id: game.id,
      user_id: game.user_id,
      difficulty: game.difficulty,
      bet_amount: game.bet_amount,
      status: game.status,
      current_level: game.current_level,
      total_floors: cfg.floors,
      final_multiplier_x100: game.status === 'cashed_out' ? finalMultiplierX100 : 0,
      payout:
        game.status === 'cashed_out' ? Math.floor((game.bet_amount * finalMultiplierX100) / 100) : 0,
      resolved_at: game.resolved_at as string,
      username: game.username,
      avatar_url: game.avatar_url,
      equipped_cosmetics: equippedByUser.get(game.user_id) ?? [],
    };
  });
}
