import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import * as sound from '../lib/sound.js';
import * as sudokuApi from '../api/sudoku.js';
import type { SudokuDifficulty, SudokuTodayAdminEntry, SudokuTodayView } from '../types.js';

const DIFFICULTIES: { value: SudokuDifficulty; label: string }[] = [
  { value: 'easy', label: 'Facile' },
  { value: 'medium', label: 'Moyen' },
  { value: 'hard', label: 'Difficile' },
];

function progressKey(puzzleDate: string, difficulty: SudokuDifficulty): string {
  return `sp_sudoku_progress_${puzzleDate}_${difficulty}`;
}

// La progression n'est qu'un confort local (survit à un rechargement de page) —
// jamais lue par le serveur, qui ne fait confiance qu'à la grille soumise à la
// vérification. On revalide contre `givens` avant de faire confiance à la
// valeur stockée : une grille sauvegardée pour une autre difficulté ne peut
// normalement pas atterrir ici (le choix du jour est verrouillé côté serveur),
// mais un joueur peut avoir une progression obsolète d'un ancien format —
// mieux vaut repartir des indices fournis que d'afficher une grille incohérente.
function loadProgress(puzzleDate: string, difficulty: SudokuDifficulty, givens: string): string {
  try {
    const raw = window.localStorage.getItem(progressKey(puzzleDate, difficulty));
    if (raw && /^[0-9]{81}$/.test(raw) && [...givens].every((g, i) => g === '0' || g === raw[i])) {
      return raw;
    }
  } catch {
    // localStorage indisponible (navigation privée…) — on repart des indices fournis
  }
  return givens;
}

function saveProgress(puzzleDate: string, difficulty: SudokuDifficulty, grid: string): void {
  try {
    window.localStorage.setItem(progressKey(puzzleDate, difficulty), grid);
  } catch {
    // silencieux : purement un confort, pas une garantie
  }
}

export default function Sudoku() {
  const { user, setUser } = useAuth();

  const [view, setView] = useState<SudokuTodayView | null>(null);
  const [grid, setGrid] = useState('');
  const [cellCorrect, setCellCorrect] = useState<boolean[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [adminOverview, setAdminOverview] = useState<SudokuTodayAdminEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCellCorrect(null);
    setMessage(null);
    try {
      const result = await sudokuApi.getToday();
      setView(result);
      if (result.status !== 'choosing') {
        setGrid(
          result.status === 'in_progress'
            ? loadProgress(result.puzzleDate, result.difficulty, result.givens)
            : (result.solution as string)
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadAdminOverview = useCallback(async () => {
    if (user?.role !== 'admin') return;
    try {
      setAdminOverview(await sudokuApi.getTodayAdmin());
    } catch {
      // silencieux : panneau MSP secondaire, ne bloque pas la partie du joueur
    }
  }, [user?.role]);

  useEffect(() => {
    loadAdminOverview();
  }, [loadAdminOverview]);

  async function handleChoose(difficulty: SudokuDifficulty) {
    if (choosing) return;
    setChoosing(true);
    setError(null);
    try {
      const result = await sudokuApi.chooseDifficulty(difficulty);
      setView(result);
      setGrid(loadProgress(result.puzzleDate, result.difficulty, result.givens));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setChoosing(false);
    }
  }

  function handleCellChange(index: number, raw: string) {
    if (!view || view.status !== 'in_progress' || view.givens[index] !== '0') return;
    const digit = raw.replace(/[^1-9]/g, '').slice(-1);
    const next = grid.slice(0, index) + (digit || '0') + grid.slice(index + 1);
    setGrid(next);
    setCellCorrect(null);
    saveProgress(view.puzzleDate, view.difficulty, next);
  }

  async function handleCheck() {
    if (!view || view.status !== 'in_progress' || checking) return;
    sound.unlockAudio();
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await sudokuApi.checkGrid(grid);
      setView({
        status: result.status,
        puzzleDate: view.puzzleDate,
        difficulty: view.difficulty,
        givens: view.givens,
        maxAttempts: result.maxAttempts,
        attemptsUsed: result.attemptsUsed,
        rewardSp: result.rewardSp,
        solution: result.solution,
      });

      if (result.status !== 'in_progress' && result.solution) {
        // Partie terminée (gagnée ou perdue) : la grille affichée devient la
        // solution révélée, pas la dernière saisie du joueur — sinon un
        // "Perdu" laisserait ses mauvaises réponses affichées alors que le
        // message annonce la solution juste au-dessus.
        setGrid(result.solution);
        setCellCorrect(null);
      } else {
        setCellCorrect(result.cellCorrect);
      }

      if (result.solved) {
        sound.playWin();
        setMessage(result.rewardGranted ? `Résolu ! +${result.rewardSp} SP` : 'Résolu !');
        if (result.rewardGranted && user) {
          setUser({ ...user, sp_balance: user.sp_balance + result.rewardSp });
        }
      } else if (result.status === 'lost') {
        sound.playLose();
      } else {
        sound.playChip();
        saveProgress(view.puzzleDate, view.difficulty, grid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setChecking(false);
    }
    await loadAdminOverview();
  }

  const filledCount = useMemo(() => grid.split('').filter((c) => c !== '0').length, [grid]);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-zinc-50">Sudoku</h1>
          <VolumeSlider />
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          Une grille générée automatiquement chaque jour — réinitialisée à minuit.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {loading || !view ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : view.status === 'choosing' ? (
          <>
            <p className="text-sm text-zinc-400 mb-4">
              Choisis ta difficulté du jour — définitif jusqu'à demain.
            </p>
            <div className="space-y-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => handleChoose(d.value)}
                  disabled={choosing}
                  className="w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 rounded-md px-4 py-3 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="font-semibold text-zinc-100">{d.label}</span>
                  <span className="text-right">
                    <span className="block text-sm text-emerald-400 font-medium">+{view.rewards[d.value]} SP</span>
                    <span className="block text-xs text-zinc-500">
                      {view.maxAttempts[d.value]} tentative{view.maxAttempts[d.value] > 1 ? 's' : ''} max
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-zinc-500 mb-3">
              Difficulté : <span className="text-zinc-300 font-medium">{DIFFICULTIES.find((d) => d.value === view.difficulty)?.label}</span>
              {' · '}
              {view.attemptsUsed}/{view.maxAttempts} tentative{view.attemptsUsed > 1 ? 's' : ''} utilisée
              {view.attemptsUsed > 1 ? 's' : ''}
            </p>

            <div
              className="grid gap-0.5 bg-zinc-700 border-2 border-zinc-600 rounded-md overflow-hidden mb-4"
              style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 81 }, (_, i) => {
                const isGiven = view.givens[i] !== '0';
                const value = grid[i] === '0' ? '' : grid[i];
                const wrong = cellCorrect !== null && grid[i] !== '0' && !cellCorrect[i];
                const col = i % 9;
                const row = Math.floor(i / 9);
                const thickRight = col % 3 === 2 && col !== 8;
                const thickBottom = row % 3 === 2 && row !== 8;
                return (
                  <input
                    key={i}
                    value={value ?? ''}
                    disabled={isGiven || view.status !== 'in_progress'}
                    onChange={(e) => handleCellChange(i, e.target.value)}
                    inputMode="numeric"
                    maxLength={1}
                    aria-label={`Case ${row + 1}-${col + 1}`}
                    className={`aspect-square text-center font-semibold text-sm sm:text-base focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-default ${
                      isGiven ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-900 text-emerald-400'
                    } ${wrong ? '!bg-red-500/20 !text-red-400' : ''} ${
                      thickRight ? 'border-r-2 border-r-zinc-500' : ''
                    } ${thickBottom ? 'border-b-2 border-b-zinc-500' : ''}`}
                  />
                );
              })}
            </div>

            {view.status === 'won' && (
              <p className="text-center text-emerald-400 font-semibold">{message ?? 'Résolu aujourd’hui ✓'}</p>
            )}
            {view.status === 'lost' && (
              <p className="text-center text-red-400 font-semibold">
                Perdu — plus de tentatives disponibles aujourd'hui. La solution est affichée ci-dessus.
              </p>
            )}
            {view.status === 'in_progress' && (() => {
              const remaining = view.maxAttempts - view.attemptsUsed;
              return (
                <>
                  <button
                    type="button"
                    onClick={handleCheck}
                    disabled={checking}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed mb-2"
                  >
                    {checking
                      ? '…'
                      : `Vérifier (${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''})`}
                  </button>
                  <p className="text-center text-xs text-zinc-500">
                    Récompense : +{view.rewardSp} SP · {filledCount}/81 cases remplies
                  </p>
                </>
              );
            })()}
          </>
        )}

        {user?.role === 'admin' && adminOverview.length > 0 && (
          <div className="mt-10 pt-6 border-t border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">MSP — Grilles du jour</h2>
            <p className="text-xs text-zinc-500 mb-3">
              Génération 100% automatique, rien à créer — ajuste les récompenses et le nombre de
              tentatives depuis la page Config.
            </p>
            <ul className="space-y-1.5">
              {adminOverview.map((entry) => (
                <li
                  key={entry.difficulty}
                  className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm"
                >
                  <span className="text-zinc-300">
                    {DIFFICULTIES.find((d) => d.value === entry.difficulty)?.label ?? entry.difficulty}
                  </span>
                  <span className="text-zinc-500 text-xs">{entry.clues} indices</span>
                  <span className="text-zinc-500 text-xs">
                    {entry.completions} résolution{entry.completions > 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
