import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import { todayLocal } from '../utils/localDate.js';
import { generatePuzzle, gridToString, type SudokuDifficulty } from '../utils/sudoku.js';
import type {
  SudokuAttemptHistoryEntry,
  SudokuAttemptRow,
  SudokuAttemptSummary,
  SudokuCheckResult,
  SudokuDailyPuzzleRow,
  SudokuGameStatus,
  SudokuGameView,
  SudokuPlayerChoiceRow,
  SudokuTodayAdminEntry,
  SudokuTodayView,
} from '../types.js';

const DIFFICULTIES: SudokuDifficulty[] = ['easy', 'medium', 'hard'];

export function isSudokuDifficulty(value: string): value is SudokuDifficulty {
  return (DIFFICULTIES as string[]).includes(value);
}

const REWARD_CONFIG_KEY: Record<SudokuDifficulty, string> = {
  easy: 'sudoku_reward_easy',
  medium: 'sudoku_reward_medium',
  hard: 'sudoku_reward_hard',
};

const REWARD_DEFAULT: Record<SudokuDifficulty, number> = {
  easy: 5,
  medium: 10,
  hard: 15,
};

const MAX_ATTEMPTS_CONFIG_KEY: Record<SudokuDifficulty, string> = {
  easy: 'sudoku_max_attempts_easy',
  medium: 'sudoku_max_attempts_medium',
  hard: 'sudoku_max_attempts_hard',
};

const MAX_ATTEMPTS_DEFAULT: Record<SudokuDifficulty, number> = {
  easy: 5,
  medium: 5,
  hard: 5,
};

const HIDE_FEEDBACK_CONFIG_KEY: Record<SudokuDifficulty, string> = {
  easy: 'sudoku_hide_feedback_easy',
  medium: 'sudoku_hide_feedback_medium',
  hard: 'sudoku_hide_feedback_hard',
};

const HIDE_FEEDBACK_DEFAULT: Record<SudokuDifficulty, boolean> = {
  easy: false,
  medium: false,
  hard: false,
};

const DIFFICULTY_LABEL: Record<SudokuDifficulty, string> = {
  easy: 'facile',
  medium: 'moyenne',
  hard: 'difficile',
};

/**
 * Récupère le puzzle du jour pour une difficulté (date locale Europe/Paris),
 * le générant s'il n'existe pas encore — même idiome que
 * motusService.getOrCreateDailyWord (création paresseuse, `ON CONFLICT DO
 * NOTHING` + relecture pour gérer la course entre deux premières requêtes de
 * la journée), mais sans file MSP à consommer ni verrou explicite : la
 * génération est pure (aucun état partagé mutable en dehors de l'insertion
 * elle-même), donc perdre la course ne coûte qu'un calcul jeté.
 */
export async function getOrCreateDailyPuzzle(
  difficulty: SudokuDifficulty,
  seasonId: number | null
): Promise<SudokuDailyPuzzleRow> {
  const dateStr = todayLocal();
  const { rows: existing } = await pool.query<SudokuDailyPuzzleRow>(
    'SELECT * FROM sudoku_daily_puzzles WHERE puzzle_date = $1 AND difficulty = $2',
    [dateStr, difficulty]
  );
  if (existing[0]) return existing[0];

  const { givens, solution } = generatePuzzle(difficulty);

  const { rows: inserted } = await pool.query<SudokuDailyPuzzleRow>(
    `INSERT INTO sudoku_daily_puzzles (puzzle_date, difficulty, givens, solution, season_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (puzzle_date, difficulty) DO NOTHING
     RETURNING *`,
    [dateStr, difficulty, gridToString(givens), gridToString(solution), seasonId]
  );
  if (inserted[0]) return inserted[0];

  const { rows: fallback } = await pool.query<SudokuDailyPuzzleRow>(
    'SELECT * FROM sudoku_daily_puzzles WHERE puzzle_date = $1 AND difficulty = $2',
    [dateStr, difficulty]
  );
  return fallback[0] as SudokuDailyPuzzleRow;
}

async function getMyChoice(userId: number, dateStr: string): Promise<SudokuPlayerChoiceRow | null> {
  const { rows } = await pool.query<SudokuPlayerChoiceRow>(
    'SELECT * FROM sudoku_player_choices WHERE puzzle_date = $1 AND user_id = $2',
    [dateStr, userId]
  );
  return rows[0] ?? null;
}

async function getRewardsByDifficulty(): Promise<Record<SudokuDifficulty, number>> {
  const [easy, medium, hard] = await Promise.all([
    configService.getConfigNumber(REWARD_CONFIG_KEY.easy, REWARD_DEFAULT.easy),
    configService.getConfigNumber(REWARD_CONFIG_KEY.medium, REWARD_DEFAULT.medium),
    configService.getConfigNumber(REWARD_CONFIG_KEY.hard, REWARD_DEFAULT.hard),
  ]);
  return { easy, medium, hard };
}

async function getMaxAttemptsByDifficulty(): Promise<Record<SudokuDifficulty, number>> {
  const [easy, medium, hard] = await Promise.all([
    configService.getConfigNumber(MAX_ATTEMPTS_CONFIG_KEY.easy, MAX_ATTEMPTS_DEFAULT.easy),
    configService.getConfigNumber(MAX_ATTEMPTS_CONFIG_KEY.medium, MAX_ATTEMPTS_DEFAULT.medium),
    configService.getConfigNumber(MAX_ATTEMPTS_CONFIG_KEY.hard, MAX_ATTEMPTS_DEFAULT.hard),
  ]);
  return { easy, medium, hard };
}

function getMaxAttempts(difficulty: SudokuDifficulty): Promise<number> {
  return configService.getConfigNumber(MAX_ATTEMPTS_CONFIG_KEY[difficulty], MAX_ATTEMPTS_DEFAULT[difficulty]);
}

async function getHideFeedbackByDifficulty(): Promise<Record<SudokuDifficulty, boolean>> {
  const [easy, medium, hard] = await Promise.all([
    configService.getConfigBool(HIDE_FEEDBACK_CONFIG_KEY.easy, HIDE_FEEDBACK_DEFAULT.easy),
    configService.getConfigBool(HIDE_FEEDBACK_CONFIG_KEY.medium, HIDE_FEEDBACK_DEFAULT.medium),
    configService.getConfigBool(HIDE_FEEDBACK_CONFIG_KEY.hard, HIDE_FEEDBACK_DEFAULT.hard),
  ]);
  return { easy, medium, hard };
}

function getHideFeedback(difficulty: SudokuDifficulty): Promise<boolean> {
  return configService.getConfigBool(HIDE_FEEDBACK_CONFIG_KEY[difficulty], HIDE_FEEDBACK_DEFAULT[difficulty]);
}

async function getMyAttempts(puzzleId: number, userId: number): Promise<SudokuAttemptRow[]> {
  const { rows } = await pool.query<SudokuAttemptRow>(
    'SELECT * FROM sudoku_attempts WHERE puzzle_id = $1 AND user_id = $2 ORDER BY attempt_number ASC',
    [puzzleId, userId]
  );
  return rows;
}

/** Ne révèle jamais les chiffres de la solution — seulement si chaque case remplie était juste. */
function computeCellCorrect(guess: string, solution: string): boolean[] {
  return guess.split('').map((ch, i) => ch !== '0' && ch === solution[i]);
}

function countWrongCells(guess: string, cellCorrect: boolean[]): number {
  return cellCorrect.reduce((count, correct, i) => count + (guess[i] !== '0' && !correct ? 1 : 0), 0);
}

/**
 * `hideFeedback` (config MSP par difficulté) cache le détail case par case —
 * `cellCorrect` vaut alors `null` et seul `wrongCount` (nombre de cases
 * fausses, sans dire lesquelles) est fourni au client.
 */
function toAttemptSummaries(
  attempts: SudokuAttemptRow[],
  solution: string,
  hideFeedback: boolean
): SudokuAttemptSummary[] {
  return attempts.map((a) => {
    const cellCorrect = computeCellCorrect(a.guess, solution);
    return {
      attemptNumber: a.attempt_number,
      isCorrect: a.is_correct,
      createdAt: a.created_at,
      guess: a.guess,
      cellCorrect: hideFeedback ? null : cellCorrect,
      wrongCount: countWrongCells(a.guess, cellCorrect),
    };
  });
}

function buildGameView(
  puzzle: SudokuDailyPuzzleRow,
  attempts: SudokuAttemptRow[],
  maxAttempts: number,
  rewardSp: number,
  hideFeedback: boolean
): SudokuGameView {
  const won = attempts.some((a) => a.is_correct);
  const status: SudokuGameStatus = won ? 'won' : attempts.length >= maxAttempts ? 'lost' : 'in_progress';
  return {
    status,
    puzzleDate: puzzle.puzzle_date,
    difficulty: puzzle.difficulty,
    givens: puzzle.givens,
    maxAttempts,
    attemptsUsed: attempts.length,
    attempts: toAttemptSummaries(attempts, puzzle.solution, hideFeedback),
    rewardSp,
    solution: status === 'in_progress' ? null : puzzle.solution,
    hideFeedback,
  };
}

/**
 * Vue du jour pour un joueur : tant qu'aucune difficulté n'a été choisie
 * aujourd'hui (date locale Europe/Paris), aucune grille n'est révélée — le
 * client doit afficher un écran de choix. Le choix, une fois fait, est
 * définitif pour la journée (voir chooseDifficulty).
 */
export async function getTodayView(userId: number, seasonId: number | null): Promise<SudokuTodayView> {
  const dateStr = todayLocal();
  const choice = await getMyChoice(userId, dateStr);

  if (!choice) {
    const [rewards, maxAttempts, hideFeedback] = await Promise.all([
      getRewardsByDifficulty(),
      getMaxAttemptsByDifficulty(),
      getHideFeedbackByDifficulty(),
    ]);
    return { status: 'choosing', rewards, maxAttempts, hideFeedback };
  }

  const [puzzle, rewardSp, maxAttempts, hideFeedback] = await Promise.all([
    getOrCreateDailyPuzzle(choice.difficulty, seasonId),
    configService.getConfigNumber(REWARD_CONFIG_KEY[choice.difficulty], REWARD_DEFAULT[choice.difficulty]),
    getMaxAttempts(choice.difficulty),
    getHideFeedback(choice.difficulty),
  ]);
  const attempts = await getMyAttempts(puzzle.id, userId);
  return buildGameView(puzzle, attempts, maxAttempts, rewardSp, hideFeedback);
}

/**
 * Enregistre le choix de difficulté du joueur pour aujourd'hui — un seul par
 * jour, définitif (rejeté si le joueur a déjà choisi une difficulté
 * différente). Verrou sur la ligne user pour sérialiser deux choix
 * concurrents du même joueur (deux onglets), même principe que
 * claimDailyBonus.
 */
export async function chooseDifficulty(
  userId: number,
  difficulty: SudokuDifficulty,
  seasonId: number | null
): Promise<SudokuGameView> {
  const dateStr = todayLocal();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: existingRows } = await client.query<SudokuPlayerChoiceRow>(
      'SELECT * FROM sudoku_player_choices WHERE puzzle_date = $1 AND user_id = $2',
      [dateStr, userId]
    );
    const existing = existingRows[0] ?? null;

    if (existing && existing.difficulty !== difficulty) {
      throw Object.assign(
        new Error(`Tu as déjà choisi la difficulté ${DIFFICULTY_LABEL[existing.difficulty]} aujourd’hui`),
        { status: 400 }
      );
    }

    if (!existing) {
      await client.query(
        'INSERT INTO sudoku_player_choices (puzzle_date, user_id, difficulty) VALUES ($1, $2, $3)',
        [dateStr, userId, difficulty]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const [puzzle, rewardSp, maxAttempts, hideFeedback] = await Promise.all([
    getOrCreateDailyPuzzle(difficulty, seasonId),
    configService.getConfigNumber(REWARD_CONFIG_KEY[difficulty], REWARD_DEFAULT[difficulty]),
    getMaxAttempts(difficulty),
    getHideFeedback(difficulty),
  ]);
  const attempts = await getMyAttempts(puzzle.id, userId);
  return buildGameView(puzzle, attempts, maxAttempts, rewardSp, hideFeedback);
}

/**
 * Vérifie la grille soumise par le joueur cellule par cellule contre la
 * solution du jour — consomme toujours une tentative, correcte ou non
 * (`sudoku_max_attempts_easy/medium/hard`, configurable MSP par difficulté),
 * même principe que motusService.submitGuess. Si la grille est entièrement
 * correcte, crédite la récompense (une seule fois : le statut "gagné" bloque
 * toute nouvelle tentative une fois atteint).
 */
export async function checkGrid(
  userId: number,
  seasonId: number | null,
  guess: string
): Promise<SudokuCheckResult> {
  if (!/^[0-9]{81}$/.test(guess)) {
    throw Object.assign(new Error('Grille invalide'), { status: 400 });
  }

  const dateStr = todayLocal();
  const choice = await getMyChoice(userId, dateStr);
  if (!choice) {
    throw Object.assign(new Error('Choisis d’abord une difficulté'), { status: 400 });
  }

  const [puzzle, rewardSp, maxAttempts, hideFeedback] = await Promise.all([
    getOrCreateDailyPuzzle(choice.difficulty, seasonId),
    configService.getConfigNumber(REWARD_CONFIG_KEY[choice.difficulty], REWARD_DEFAULT[choice.difficulty]),
    getMaxAttempts(choice.difficulty),
    getHideFeedback(choice.difficulty),
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: existingAttempts } = await client.query<SudokuAttemptRow>(
      'SELECT * FROM sudoku_attempts WHERE puzzle_id = $1 AND user_id = $2 ORDER BY attempt_number ASC',
      [puzzle.id, userId]
    );

    if (existingAttempts.some((a) => a.is_correct)) {
      throw Object.assign(new Error('Tu as déjà résolu la grille du jour'), { status: 400 });
    }
    if (existingAttempts.length >= maxAttempts) {
      throw Object.assign(new Error('Plus de tentatives disponibles aujourd’hui'), { status: 400 });
    }

    const cellCorrect = computeCellCorrect(guess, puzzle.solution);
    const isCorrect = cellCorrect.every(Boolean);
    const wrongCount = countWrongCells(guess, cellCorrect);
    const attemptNumber = existingAttempts.length + 1;

    const { rows: insertedRows } = await client.query<{ created_at: string }>(
      `INSERT INTO sudoku_attempts (puzzle_id, user_id, attempt_number, guess, is_correct)
       VALUES ($1, $2, $3, $4, $5) RETURNING created_at`,
      [puzzle.id, userId, attemptNumber, guess, isCorrect]
    );
    const insertedAt = insertedRows[0]?.created_at as string;

    if (isCorrect && rewardSp > 0) {
      await spService.creditSP({
        userId,
        amount: rewardSp,
        type: 'sudoku_reward',
        seasonId,
        relatedId: puzzle.id,
        note: `Sudoku — grille du jour (${choice.difficulty}) résolue`,
        client,
      });
    }

    await client.query('COMMIT');

    const status: SudokuGameStatus = isCorrect ? 'won' : attemptNumber >= maxAttempts ? 'lost' : 'in_progress';
    const attempts = [
      ...toAttemptSummaries(existingAttempts, puzzle.solution, hideFeedback),
      {
        attemptNumber,
        isCorrect,
        createdAt: insertedAt,
        guess,
        cellCorrect: hideFeedback ? null : cellCorrect,
        wrongCount,
      },
    ];

    return {
      solved: isCorrect,
      cellCorrect: hideFeedback ? null : cellCorrect,
      wrongCount,
      status,
      attemptsUsed: attemptNumber,
      maxAttempts,
      attempts,
      rewardSp,
      rewardGranted: isCorrect && rewardSp > 0,
      solution: status === 'in_progress' ? null : puzzle.solution,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Vue MSP : toutes les soumissions de tous les joueurs, tous jours et
 * difficultés confondus, les plus récentes d'abord — même principe que
 * motusService.listRecentAttempts.
 */
export async function listRecentAttempts(limit: number): Promise<SudokuAttemptHistoryEntry[]> {
  const { rows } = await pool.query<SudokuAttemptHistoryEntry>(
    `SELECT a.id, a.user_id, a.puzzle_id, a.attempt_number, a.is_correct, a.created_at,
            u.username, p.puzzle_date, p.difficulty
     FROM sudoku_attempts a
     JOIN users u ON u.id = a.user_id
     JOIN sudoku_daily_puzzles p ON p.id = a.puzzle_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Vue MSP en lecture seule : rien à créer (génération automatique), juste un aperçu du jour. */
export async function getTodayAdminView(seasonId: number | null): Promise<SudokuTodayAdminEntry[]> {
  return Promise.all(
    DIFFICULTIES.map(async (difficulty) => {
      const puzzle = await getOrCreateDailyPuzzle(difficulty, seasonId);
      const { rows } = await pool.query<{ count: string }>(
        'SELECT COUNT(DISTINCT user_id) FROM sudoku_attempts WHERE puzzle_id = $1 AND is_correct = true',
        [puzzle.id]
      );
      const clues = puzzle.givens.split('').filter((c) => c !== '0').length;
      return {
        difficulty,
        puzzleDate: puzzle.puzzle_date,
        clues,
        completions: Number(rows[0]?.count ?? 0),
      };
    })
  );
}
