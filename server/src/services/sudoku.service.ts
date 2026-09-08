import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import { todayLocal } from '../utils/localDate.js';
import { generatePuzzle, gridToString, type SudokuDifficulty } from '../utils/sudoku.js';
import type {
  SudokuAttemptHistoryEntry,
  SudokuAttemptRow,
  SudokuDailyPuzzleRow,
  SudokuGameStatus,
  SudokuGameView,
  SudokuPlayerChoiceRow,
  SudokuSubmitResult,
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

// Clé/valeur admin_config inchangées depuis le système "grille entière" — seul
// leur sens a changé (nombre max d'ERREURS avant de perdre, plus nombre max de
// vérifications de grille) — voir migration 065.
const MAX_MISTAKES_CONFIG_KEY: Record<SudokuDifficulty, string> = {
  easy: 'sudoku_max_attempts_easy',
  medium: 'sudoku_max_attempts_medium',
  hard: 'sudoku_max_attempts_hard',
};

const MAX_MISTAKES_DEFAULT: Record<SudokuDifficulty, number> = {
  easy: 5,
  medium: 5,
  hard: 5,
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

async function getMaxMistakesByDifficulty(): Promise<Record<SudokuDifficulty, number>> {
  const [easy, medium, hard] = await Promise.all([
    configService.getConfigNumber(MAX_MISTAKES_CONFIG_KEY.easy, MAX_MISTAKES_DEFAULT.easy),
    configService.getConfigNumber(MAX_MISTAKES_CONFIG_KEY.medium, MAX_MISTAKES_DEFAULT.medium),
    configService.getConfigNumber(MAX_MISTAKES_CONFIG_KEY.hard, MAX_MISTAKES_DEFAULT.hard),
  ]);
  return { easy, medium, hard };
}

function getMaxMistakes(difficulty: SudokuDifficulty): Promise<number> {
  return configService.getConfigNumber(MAX_MISTAKES_CONFIG_KEY[difficulty], MAX_MISTAKES_DEFAULT[difficulty]);
}

async function getMyAttempts(puzzleId: number, userId: number): Promise<SudokuAttemptRow[]> {
  const { rows } = await pool.query<SudokuAttemptRow>(
    'SELECT * FROM sudoku_attempts WHERE puzzle_id = $1 AND user_id = $2 ORDER BY attempt_number ASC',
    [puzzleId, userId]
  );
  return rows;
}

function countGivens(givens: string): number {
  return givens.split('').filter((c) => c !== '0').length;
}

/** Une case verrouillée = une soumission juste pour cet index — jamais resoumise une fois correcte. */
function countCorrect(attempts: SudokuAttemptRow[]): number {
  return attempts.filter((a) => a.is_correct).length;
}

/** Grille de 81 caractères : chiffre validé par le joueur à chaque case correcte, '0' ailleurs (cases données incluses). */
function buildValidatedGrid(attempts: SudokuAttemptRow[]): string {
  const chars = new Array(81).fill('0');
  for (const a of attempts) {
    if (a.is_correct) chars[a.cell_index] = a.digit;
  }
  return chars.join('');
}

function buildGameView(
  puzzle: SudokuDailyPuzzleRow,
  attempts: SudokuAttemptRow[],
  maxMistakes: number,
  rewardSp: number
): SudokuGameView {
  const correctCount = countCorrect(attempts);
  const mistakesUsed = attempts.length - correctCount;
  const totalNonGiven = 81 - countGivens(puzzle.givens);
  const won = correctCount >= totalNonGiven;
  const status: SudokuGameStatus = won ? 'won' : mistakesUsed >= maxMistakes ? 'lost' : 'in_progress';
  return {
    status,
    puzzleDate: puzzle.puzzle_date,
    difficulty: puzzle.difficulty,
    givens: puzzle.givens,
    maxMistakes,
    mistakesUsed,
    validated: buildValidatedGrid(attempts),
    rewardSp,
    solution: status === 'in_progress' ? null : puzzle.solution,
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
    const [rewards, maxMistakes] = await Promise.all([getRewardsByDifficulty(), getMaxMistakesByDifficulty()]);
    return { status: 'choosing', rewards, maxMistakes };
  }

  const [puzzle, rewardSp, maxMistakes] = await Promise.all([
    getOrCreateDailyPuzzle(choice.difficulty, seasonId),
    configService.getConfigNumber(REWARD_CONFIG_KEY[choice.difficulty], REWARD_DEFAULT[choice.difficulty]),
    getMaxMistakes(choice.difficulty),
  ]);
  const attempts = await getMyAttempts(puzzle.id, userId);
  return buildGameView(puzzle, attempts, maxMistakes, rewardSp);
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

  const [puzzle, rewardSp, maxMistakes] = await Promise.all([
    getOrCreateDailyPuzzle(difficulty, seasonId),
    configService.getConfigNumber(REWARD_CONFIG_KEY[difficulty], REWARD_DEFAULT[difficulty]),
    getMaxMistakes(difficulty),
  ]);
  const attempts = await getMyAttempts(puzzle.id, userId);
  return buildGameView(puzzle, attempts, maxMistakes, rewardSp);
}

/**
 * Soumet un seul chiffre pour une seule case — appelé dès que le joueur tape
 * un chiffre, pas via un bouton "Vérifier" (refacto demandé par l'utilisateur
 * pour se rapprocher des sites de sudoku classiques). Juste, la case se
 * verrouille (comme un indice) et ne peut plus être resoumise ; fausse, elle
 * reste éditable mais consomme une erreur (`sudoku_max_attempts_*`,
 * configurable MSP par difficulté — désormais une limite d'erreurs, plus un
 * nombre de vérifications). Si la dernière case manquante devient correcte,
 * la grille est gagnée et la récompense créditée (une seule fois, verrouillé
 * par la contrainte "case déjà validée").
 */
export async function submitCell(
  userId: number,
  seasonId: number | null,
  cellIndex: number,
  digit: string
): Promise<SudokuSubmitResult> {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 80) {
    throw Object.assign(new Error('Case invalide'), { status: 400 });
  }
  if (!/^[1-9]$/.test(digit)) {
    throw Object.assign(new Error('Chiffre invalide'), { status: 400 });
  }

  const dateStr = todayLocal();
  const choice = await getMyChoice(userId, dateStr);
  if (!choice) {
    throw Object.assign(new Error('Choisis d’abord une difficulté'), { status: 400 });
  }

  const [puzzle, rewardSp, maxMistakes] = await Promise.all([
    getOrCreateDailyPuzzle(choice.difficulty, seasonId),
    configService.getConfigNumber(REWARD_CONFIG_KEY[choice.difficulty], REWARD_DEFAULT[choice.difficulty]),
    getMaxMistakes(choice.difficulty),
  ]);

  if (puzzle.givens[cellIndex] !== '0') {
    throw Object.assign(new Error('Cette case est déjà un indice'), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: existingAttempts } = await client.query<SudokuAttemptRow>(
      'SELECT * FROM sudoku_attempts WHERE puzzle_id = $1 AND user_id = $2 ORDER BY attempt_number ASC',
      [puzzle.id, userId]
    );

    const correctCount = countCorrect(existingAttempts);
    const mistakesUsed = existingAttempts.length - correctCount;
    const totalNonGiven = 81 - countGivens(puzzle.givens);

    if (correctCount >= totalNonGiven) {
      throw Object.assign(new Error('Tu as déjà résolu la grille du jour'), { status: 400 });
    }
    if (mistakesUsed >= maxMistakes) {
      throw Object.assign(new Error('Plus d’erreurs disponibles aujourd’hui'), { status: 400 });
    }
    if (existingAttempts.some((a) => a.is_correct && a.cell_index === cellIndex)) {
      throw Object.assign(new Error('Cette case est déjà validée'), { status: 400 });
    }

    const isCorrect = puzzle.solution[cellIndex] === digit;
    const attemptNumber = existingAttempts.length + 1;

    await client.query(
      `INSERT INTO sudoku_attempts (puzzle_id, user_id, attempt_number, cell_index, digit, is_correct)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [puzzle.id, userId, attemptNumber, cellIndex, digit, isCorrect]
    );

    const nextCorrectCount = correctCount + (isCorrect ? 1 : 0);
    const nextMistakes = mistakesUsed + (isCorrect ? 0 : 1);
    const won = nextCorrectCount >= totalNonGiven;
    const rewardGranted = won && rewardSp > 0;

    if (rewardGranted) {
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

    const status: SudokuGameStatus = won ? 'won' : nextMistakes >= maxMistakes ? 'lost' : 'in_progress';

    return {
      correct: isCorrect,
      cellIndex,
      status,
      mistakesUsed: nextMistakes,
      maxMistakes,
      rewardSp,
      rewardGranted,
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
    `SELECT a.id, a.user_id, a.puzzle_id, a.attempt_number, a.cell_index, a.digit, a.is_correct, a.created_at,
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
      const totalNonGiven = 81 - countGivens(puzzle.givens);
      // "Complété" = toutes les cases non-données validées correctes, pas juste une case juste au hasard.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM (
           SELECT user_id FROM sudoku_attempts
           WHERE puzzle_id = $1 AND is_correct = true
           GROUP BY user_id
           HAVING COUNT(*) >= $2
         ) t`,
        [puzzle.id, totalNonGiven]
      );
      return {
        difficulty,
        puzzleDate: puzzle.puzzle_date,
        clues: countGivens(puzzle.givens),
        completions: Number(rows[0]?.count ?? 0),
      };
    })
  );
}
