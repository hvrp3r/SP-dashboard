import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import * as sound from '../lib/sound.js';
import * as sudokuApi from '../api/sudoku.js';
import type { SudokuAttemptHistoryEntry, SudokuDifficulty, SudokuTodayAdminEntry, SudokuTodayView } from '../types.js';

const DIFFICULTIES: { value: SudokuDifficulty; label: string }[] = [
  { value: 'easy', label: 'Facile' },
  { value: 'medium', label: 'Moyen' },
  { value: 'hard', label: 'Difficile' },
];

interface SavedProgress {
  grid: string;
  notes: string[];
}

function emptyNotes(): string[] {
  return new Array(81).fill('');
}

function progressKey(puzzleDate: string, difficulty: SudokuDifficulty): string {
  return `sp_sudoku_progress_${puzzleDate}_${difficulty}`;
}

// La progression (grille + annotations) n'est qu'un confort local (survit à un
// rechargement de page) — jamais lue par le serveur, qui ne fait confiance qu'à
// la grille soumise à la vérification (les annotations n'y sont jamais envoyées,
// ce sont de simples brouillons du joueur). On revalide la grille stockée contre
// `givens` avant de lui faire confiance : un ancien format ou une progression
// incohérente retombe simplement sur les indices fournis plutôt que de planter.
function loadProgress(puzzleDate: string, difficulty: SudokuDifficulty, givens: string): SavedProgress {
  try {
    const raw = window.localStorage.getItem(progressKey(puzzleDate, difficulty));
    if (raw) {
      const parsed = JSON.parse(raw) as { grid?: unknown; notes?: unknown };
      const { grid, notes } = parsed;
      const validGrid =
        typeof grid === 'string' &&
        /^[0-9]{81}$/.test(grid) &&
        [...givens].every((g, i) => g === '0' || g === grid[i]);
      const validNotes = Array.isArray(notes) && notes.length === 81 && notes.every((n) => typeof n === 'string');
      if (validGrid) {
        return { grid: grid as string, notes: validNotes ? (notes as string[]) : emptyNotes() };
      }
    }
  } catch {
    // JSON invalide ou localStorage indisponible (navigation privée…) — on repart des indices fournis
  }
  return { grid: givens, notes: emptyNotes() };
}

function saveProgress(puzzleDate: string, difficulty: SudokuDifficulty, grid: string, notes: string[]): void {
  try {
    window.localStorage.setItem(progressKey(puzzleDate, difficulty), JSON.stringify({ grid, notes }));
  } catch {
    // silencieux : purement un confort, pas une garantie
  }
}

/** Aperçu en lecture seule d'une grille soumise passée — mêmes couleurs que la grille jouable, sans interaction. */
function AttemptGridPreview({ givens, guess, cellCorrect }: { givens: string; guess: string; cellCorrect: boolean[] }) {
  return (
    <div
      className="grid gap-0.5 bg-zinc-700 border-2 border-zinc-600 rounded-md overflow-hidden mt-2"
      style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))' }}
    >
      {Array.from({ length: 81 }, (_, i) => {
        const isGiven = givens[i] !== '0';
        const value = guess[i] === '0' ? '' : guess[i];
        const wrong = guess[i] !== '0' && !cellCorrect[i];
        const col = i % 9;
        const row = Math.floor(i / 9);
        const thickRight = col % 3 === 2 && col !== 8;
        const thickBottom = row % 3 === 2 && row !== 8;
        return (
          <div
            key={i}
            className={`aspect-square flex items-center justify-center font-semibold text-xs ${
              isGiven ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-900 text-emerald-400'
            } ${wrong ? '!bg-red-500/20 !text-red-400' : ''} ${
              thickRight ? 'border-r-2 border-r-zinc-500' : ''
            } ${thickBottom ? 'border-b-2 border-b-zinc-500' : ''}`}
          >
            {value}
          </div>
        );
      })}
    </div>
  );
}

export default function Sudoku() {
  const { user, setUser } = useAuth();

  const [view, setView] = useState<SudokuTodayView | null>(null);
  const [grid, setGrid] = useState('');
  const [notes, setNotes] = useState<string[]>(emptyNotes());
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [cellCorrect, setCellCorrect] = useState<boolean[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [adminOverview, setAdminOverview] = useState<SudokuTodayAdminEntry[]>([]);
  const [attemptsHistory, setAttemptsHistory] = useState<SudokuAttemptHistoryEntry[]>([]);
  const [expandedAttempt, setExpandedAttempt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCellCorrect(null);
    setMessage(null);
    setSelected(null);
    setExpandedAttempt(null);
    try {
      const result = await sudokuApi.getToday();
      setView(result);
      if (result.status === 'in_progress') {
        const saved = loadProgress(result.puzzleDate, result.difficulty, result.givens);
        setGrid(saved.grid);
        setNotes(saved.notes);
      } else if (result.status !== 'choosing') {
        setGrid(result.solution as string);
        setNotes(emptyNotes());
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
      const [overview, history] = await Promise.all([sudokuApi.getTodayAdmin(), sudokuApi.listAttempts(30)]);
      setAdminOverview(overview);
      setAttemptsHistory(history);
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
      const saved = loadProgress(result.puzzleDate, result.difficulty, result.givens);
      setGrid(saved.grid);
      setNotes(saved.notes);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setChoosing(false);
    }
  }

  function selectCell(index: number) {
    if (!view || view.status !== 'in_progress' || view.givens[index] !== '0') return;
    setSelected(index);
  }

  // Une case pleine ne peut pas porter d'annotation (pas de sens à noter des
  // candidats sur une case déjà remplie) ; taper le même chiffre efface la
  // case plutôt que de la resaisir — pratique pour corriger sans passer par
  // le bouton Effacer.
  function applyDigit(digit: number) {
    if (!view || view.status !== 'in_progress' || selected === null) return;
    const ch = String(digit);

    if (notesMode) {
      if (grid[selected] !== '0') return;
      const current = notes[selected] ?? '';
      const nextCell = current.includes(ch) ? current.replace(ch, '') : [...current, ch].sort().join('');
      const nextNotes = notes.slice();
      nextNotes[selected] = nextCell;
      setNotes(nextNotes);
      saveProgress(view.puzzleDate, view.difficulty, grid, nextNotes);
      return;
    }

    const nextChar = grid[selected] === ch ? '0' : ch;
    const nextGrid = grid.slice(0, selected) + nextChar + grid.slice(selected + 1);
    // Remplir une case efface ses annotations (elles n'ont plus de raison d'être) ;
    // l'effacer les laisse intactes, au cas où le joueur les reprendrait ensuite.
    const nextNotes = nextChar === '0' ? notes : setAt(notes, selected, '');
    setGrid(nextGrid);
    setNotes(nextNotes);
    setCellCorrect(null);
    saveProgress(view.puzzleDate, view.difficulty, nextGrid, nextNotes);
  }

  function handleErase() {
    if (!view || view.status !== 'in_progress' || selected === null) return;
    const nextGrid = grid.slice(0, selected) + '0' + grid.slice(selected + 1);
    const nextNotes = setAt(notes, selected, '');
    setGrid(nextGrid);
    setNotes(nextNotes);
    setCellCorrect(null);
    saveProgress(view.puzzleDate, view.difficulty, nextGrid, nextNotes);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!view || view.status !== 'in_progress' || selected === null) return;
      if (e.key >= '1' && e.key <= '9') {
        applyDigit(Number(e.key));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleErase();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected, grid, notes, notesMode]);

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
        attempts: result.attempts,
        rewardSp: result.rewardSp,
        solution: result.solution,
      });

      if (result.status !== 'in_progress' && result.solution) {
        // Partie terminée (gagnée ou perdue) : la grille affichée devient la
        // solution révélée, pas la dernière saisie du joueur — sinon un
        // "Perdu" laisserait ses mauvaises réponses affichées alors que le
        // message annonce la solution juste au-dessus.
        setGrid(result.solution);
        setNotes(emptyNotes());
        setCellCorrect(null);
        setSelected(null);
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
        saveProgress(view.puzzleDate, view.difficulty, grid, notes);
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
              className="grid gap-0.5 bg-zinc-700 border-2 border-zinc-600 rounded-md overflow-hidden mb-3"
              style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 81 }, (_, i) => {
                const isGiven = view.givens[i] !== '0';
                const hasValue = grid[i] !== '0';
                const wrong = cellCorrect !== null && hasValue && !cellCorrect[i];
                const isSelected = selected === i;
                const col = i % 9;
                const row = Math.floor(i / 9);
                const thickRight = col % 3 === 2 && col !== 8;
                const thickBottom = row % 3 === 2 && row !== 8;
                const cellNotes = notes[i] ?? '';

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectCell(i)}
                    disabled={isGiven || view.status !== 'in_progress'}
                    aria-label={`Case ${row + 1}-${col + 1}`}
                    className={`aspect-square flex items-center justify-center font-semibold text-sm sm:text-base disabled:cursor-default ${
                      isGiven ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-900 text-emerald-400'
                    } ${wrong ? '!bg-red-500/20 !text-red-400' : ''} ${
                      isSelected ? '!bg-emerald-500/20 ring-1 ring-inset ring-emerald-500' : ''
                    } ${thickRight ? 'border-r-2 border-r-zinc-500' : ''} ${
                      thickBottom ? 'border-b-2 border-b-zinc-500' : ''
                    }`}
                  >
                    {hasValue ? (
                      grid[i]
                    ) : cellNotes ? (
                      <span className="grid grid-cols-3 grid-rows-3 w-full h-full text-[9px] sm:text-[10px] font-semibold leading-none text-zinc-400 p-0.5">
                        {Array.from({ length: 9 }, (_, n) => (
                          <span key={n} className="flex items-center justify-center">
                            {cellNotes.includes(String(n + 1)) ? n + 1 : ''}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {view.status === 'in_progress' && (
              <div className="mb-3">
                <div className="grid grid-cols-9 gap-1 mb-2">
                  {Array.from({ length: 9 }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => applyDigit(n + 1)}
                      disabled={selected === null}
                      className="aspect-square bg-zinc-900 border border-zinc-800 rounded-md text-zinc-100 font-semibold text-sm hover:border-emerald-500/50 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {n + 1}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNotesMode((v) => !v)}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                      notesMode
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    ✏️ Annotations {notesMode ? 'activées' : 'désactivées'}
                  </button>
                  <button
                    type="button"
                    onClick={handleErase}
                    disabled={selected === null}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Effacer
                  </button>
                </div>
              </div>
            )}

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

            {view.attempts.length > 0 && (
              <div className="mt-6">
                <h2 className="text-xs font-semibold text-zinc-400 uppercase mb-2">Mes tentatives</h2>
                <ul className="space-y-1">
                  {view.attempts.map((a) => {
                    const expanded = expandedAttempt === a.attemptNumber;
                    return (
                      <li key={a.attemptNumber} className="bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setExpandedAttempt(expanded ? null : a.attemptNumber)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-800/60 transition"
                        >
                          <span className={a.isCorrect ? 'text-emerald-400' : 'text-zinc-500'}>
                            {a.isCorrect ? '✅' : '❌'}
                          </span>
                          <span className="text-zinc-400 flex-1 text-left">Tentative #{a.attemptNumber}</span>
                          <span className="text-zinc-600">
                            {new Date(a.createdAt).toLocaleString('fr-FR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="text-zinc-600">{expanded ? '▲' : '▼'}</span>
                        </button>
                        {expanded && (
                          <div className="px-3 pb-3">
                            <AttemptGridPreview givens={view.givens} guess={a.guess} cellCorrect={a.cellCorrect} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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

            <h2 className="text-sm font-semibold text-zinc-300 uppercase mt-6 mb-3">
              MSP — Soumissions récentes
            </h2>
            {attemptsHistory.length === 0 ? (
              <p className="text-sm text-zinc-500">Aucune soumission pour le moment.</p>
            ) : (
              <ul className="space-y-1">
                {attemptsHistory.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs"
                  >
                    <span className={a.is_correct ? 'text-emerald-400' : 'text-zinc-500'}>
                      {a.is_correct ? '✅' : '❌'}
                    </span>
                    <span className="text-zinc-200 font-medium flex-shrink-0">{a.username}</span>
                    <span className="text-zinc-400 flex-1 truncate">
                      {DIFFICULTIES.find((d) => d.value === a.difficulty)?.label ?? a.difficulty}
                    </span>
                    <span className="text-zinc-600 flex-shrink-0">#{a.attempt_number}</span>
                    <span className="text-zinc-600 flex-shrink-0">
                      {new Date(a.created_at).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function setAt(arr: string[], index: number, value: string): string[] {
  const next = arr.slice();
  next[index] = value;
  return next;
}
