/**
 * Génération de grilles Sudoku : remplissage complet par backtracking randomisé,
 * puis retrait de cases une à une tant que la solution reste unique. Utilisé
 * uniquement côté serveur (server/src/services/sudoku.service.ts) — le client
 * ne reçoit que les indices (`givens`) et jamais l'algorithme.
 */

const SIZE = 9;
const BOX = 3;
const CELLS = SIZE * SIZE;

export type SudokuDifficulty = 'easy' | 'medium' | 'hard';

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

function isSafe(grid: number[], index: number, value: number): boolean {
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;

  for (let c = 0; c < SIZE; c++) {
    if (grid[row * SIZE + c] === value) return false;
  }
  for (let r = 0; r < SIZE; r++) {
    if (grid[r * SIZE + col] === value) return false;
  }
  const boxRow = row - (row % BOX);
  const boxCol = col - (col % BOX);
  for (let r = 0; r < BOX; r++) {
    for (let c = 0; c < BOX; c++) {
      if (grid[(boxRow + r) * SIZE + (boxCol + c)] === value) return false;
    }
  }
  return true;
}

function findEmpty(grid: number[]): number {
  return grid.indexOf(0);
}

function fillGrid(grid: number[]): boolean {
  const index = findEmpty(grid);
  if (index === -1) return true;

  for (const value of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (isSafe(grid, index, value)) {
      grid[index] = value;
      if (fillGrid(grid)) return true;
      grid[index] = 0;
    }
  }
  return false;
}

function generateSolvedGrid(): number[] {
  const grid = new Array<number>(CELLS).fill(0);
  fillGrid(grid);
  return grid;
}

/**
 * Compte les solutions d'une grille, plafonné à `limit` (arrêt anticipé dès
 * qu'atteint) — sert uniquement à vérifier l'unicité pendant le retrait de
 * cases, jamais à résoudre pour de vrai. `budget` borne le nombre total de
 * cases explorées : au-delà, on renvoie `limit` par défaut (donc "pas
 * unique") plutôt que de laisser une grille très clairsemée exploser en
 * temps de calcul — la case candidate est alors simplement remise en place,
 * ce qui peut laisser une difficulté "hard" légèrement en-deçà de sa cible
 * de retraits mais garantit toujours une solution unique.
 */
function countSolutions(grid: number[], limit: number, budget: { left: number }): number {
  if (budget.left-- <= 0) return limit;

  const index = findEmpty(grid);
  if (index === -1) return 1;

  let count = 0;
  for (let value = 1; value <= 9; value++) {
    if (isSafe(grid, index, value)) {
      grid[index] = value;
      count += countSolutions(grid, limit - count, budget);
      grid[index] = 0;
      if (count >= limit) break;
    }
  }
  return count;
}

const TARGET_CLUES: Record<SudokuDifficulty, number> = {
  easy: 40,
  medium: 32,
  hard: 26,
};

/**
 * Génère un puzzle à solution unique pour la difficulté demandée : part d'une
 * grille complète et retire des cases en ordre aléatoire, en ne gardant
 * chaque retrait que si la grille reste résolvable de façon unique. Le
 * nombre d'indices restants (`TARGET_CLUES`) est indicatif, pas garanti au
 * chiffre près — seule l'unicité de la solution est une garantie stricte.
 */
export function generatePuzzle(difficulty: SudokuDifficulty): { givens: number[]; solution: number[] } {
  const solution = generateSolvedGrid();
  const givens = [...solution];
  const targetClues = TARGET_CLUES[difficulty];

  let clues = CELLS;
  for (const index of shuffle(Array.from({ length: CELLS }, (_, i) => i))) {
    if (clues <= targetClues) break;

    const backup = givens[index] as number;
    givens[index] = 0;

    const attempt = [...givens];
    const solutions = countSolutions(attempt, 2, { left: 50000 });

    if (solutions === 1) {
      clues--;
    } else {
      givens[index] = backup;
    }
  }

  return { givens, solution };
}

export function gridToString(grid: number[]): string {
  return grid.join('');
}
