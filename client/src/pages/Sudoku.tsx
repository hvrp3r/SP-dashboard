import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import * as sound from '../lib/sound.js';
import * as sudokuApi from '../api/sudoku.js';
import type {
  SudokuAttemptHistoryEntry,
  SudokuDifficulty,
  SudokuGameView,
  SudokuTodayAdminEntry,
  SudokuTodayView,
} from '../types.js';

const DIFFICULTIES: { value: SudokuDifficulty; label: string }[] = [
  { value: 'easy', label: 'Facile' },
  { value: 'medium', label: 'Moyen' },
  { value: 'hard', label: 'Difficile' },
];

interface SavedProgress {
  drafts: Record<number, string>;
  notes: string[];
}

function emptyNotes(): string[] {
  return new Array(81).fill('');
}

function setAt(arr: string[], index: number, value: string): string[] {
  const next = arr.slice();
  next[index] = value;
  return next;
}

function progressKey(puzzleDate: string, difficulty: SudokuDifficulty): string {
  return `sp_sudoku_progress_${puzzleDate}_${difficulty}`;
}

// Le brouillon (chiffres pas encore validés + annotations) n'est qu'un confort
// local (survit à un rechargement de page) — jamais lu par le serveur, qui ne
// fait confiance qu'aux cases déjà validées (`view.validated`). Une case
// validée entre-temps sur un autre appareil, ou redevenue un indice (nouveau
// jour), est filtrée plutôt que de faire planter l'affichage.
function loadProgress(puzzleDate: string, difficulty: SudokuDifficulty, givens: string, validated: string): SavedProgress {
  try {
    const raw = window.localStorage.getItem(progressKey(puzzleDate, difficulty));
    if (raw) {
      const parsed = JSON.parse(raw) as { drafts?: unknown; notes?: unknown };
      const drafts: Record<number, string> = {};
      const rawDrafts = parsed.drafts;
      if (rawDrafts && typeof rawDrafts === 'object') {
        for (const [key, value] of Object.entries(rawDrafts as Record<string, unknown>)) {
          const index = Number(key);
          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index <= 80 &&
            typeof value === 'string' &&
            /^[1-9]$/.test(value) &&
            givens[index] === '0' &&
            validated[index] === '0'
          ) {
            drafts[index] = value;
          }
        }
      }
      const notes = parsed.notes;
      const validNotes = Array.isArray(notes) && notes.length === 81 && notes.every((n) => typeof n === 'string');
      return { drafts, notes: validNotes ? (notes as string[]) : emptyNotes() };
    }
  } catch {
    // JSON invalide ou localStorage indisponible (navigation privée…) — on repart d'un brouillon vide
  }
  return { drafts: {}, notes: emptyNotes() };
}

function saveProgress(puzzleDate: string, difficulty: SudokuDifficulty, drafts: Record<number, string>, notes: string[]): void {
  try {
    window.localStorage.setItem(progressKey(puzzleDate, difficulty), JSON.stringify({ drafts, notes }));
  } catch {
    // silencieux : purement un confort, pas une garantie
  }
}

/** Grille affichée = indices + cases validées par le serveur + brouillon local pour le reste. */
function buildGrid(givens: string, validated: string, drafts: Record<number, string>): string {
  return Array.from({ length: 81 }, (_, i) => {
    if (givens[i] !== '0') return givens[i];
    if (validated[i] !== '0') return validated[i];
    return drafts[i] ?? '0';
  }).join('');
}

function isCellLocked(view: SudokuGameView, index: number): boolean {
  return view.givens[index] !== '0' || view.validated[index] !== '0';
}

export default function Sudoku() {
  const { user, setUser } = useAuth();

  const [view, setView] = useState<SudokuTodayView | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<string[]>(emptyNotes());
  const [wrongCells, setWrongCells] = useState<Set<number>>(new Set());
  const [pendingCells, setPendingCells] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Alerte transitoire après chaque case soumise (juste/faux) — distincte de
  // `message`, réservé au texte de fin de partie (gagné/perdu).
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const [adminOverview, setAdminOverview] = useState<SudokuTodayAdminEntry[]>([]);
  const [attemptsHistory, setAttemptsHistory] = useState<SudokuAttemptHistoryEntry[]>([]);

  const grid = useMemo(() => {
    if (!view || view.status === 'choosing') return '';
    if (view.status !== 'in_progress') return view.solution ?? buildGrid(view.givens, view.validated, {});
    return buildGrid(view.givens, view.validated, drafts);
  }, [view, drafts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    setFeedback(null);
    setSelected(null);
    setWrongCells(new Set());
    setPendingCells(new Set());
    try {
      const result = await sudokuApi.getToday();
      setView(result);
      if (result.status === 'in_progress') {
        const saved = loadProgress(result.puzzleDate, result.difficulty, result.givens, result.validated);
        setDrafts(saved.drafts);
        setWrongCells(new Set(Object.keys(saved.drafts).map(Number)));
        setNotes(saved.notes);
      } else if (result.status !== 'choosing') {
        setDrafts({});
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

  // Persistance du brouillon (cases pas encore validées + annotations) — pas
  // pour les cases déjà validées, qui vivent côté serveur (`view.validated`).
  useEffect(() => {
    if (!view || view.status !== 'in_progress') return;
    saveProgress(view.puzzleDate, view.difficulty, drafts, notes);
  }, [view, drafts, notes]);

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
      const saved = loadProgress(result.puzzleDate, result.difficulty, result.givens, result.validated);
      setDrafts(saved.drafts);
      setWrongCells(new Set(Object.keys(saved.drafts).map(Number)));
      setNotes(saved.notes);
      setSelected(null);
      setFeedback(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setChoosing(false);
    }
  }

  function selectCell(index: number) {
    if (!view || view.status !== 'in_progress' || isCellLocked(view, index)) return;
    setSelected(index);
  }

  /**
   * Soumet immédiatement la case au serveur dès qu'un chiffre est saisi
   * (refacto demandée par l'utilisateur, comme les sites de sudoku
   * classiques) — plus de bouton "Vérifier". La case affiche le chiffre tout
   * de suite (optimiste) ; juste, elle se verrouille au retour serveur ;
   * fausse, elle reste éditable et compte comme une erreur.
   */
  async function submitDigit(index: number, digit: number) {
    setPendingCells((prev) => new Set(prev).add(index));
    sound.unlockAudio();
    setError(null);
    try {
      const result = await sudokuApi.submitCell(index, digit);

      setView((prev): SudokuTodayView | null => {
        if (!prev || prev.status === 'choosing') return prev;
        const nextValidated = result.correct
          ? prev.validated.slice(0, index) + String(digit) + prev.validated.slice(index + 1)
          : prev.validated;
        return {
          ...prev,
          status: result.status,
          mistakesUsed: result.mistakesUsed,
          maxMistakes: result.maxMistakes,
          validated: nextValidated,
          rewardSp: result.rewardSp,
          solution: result.solution,
        };
      });

      if (result.correct) {
        setDrafts((prev) => {
          if (!(index in prev)) return prev;
          const next = { ...prev };
          delete next[index];
          return next;
        });
      } else {
        setWrongCells((prev) => new Set(prev).add(index));
      }

      if (result.status === 'won') {
        setDrafts({});
        setNotes(emptyNotes());
        setWrongCells(new Set());
        setSelected(null);
        setFeedback(null);
        sound.playWin();
        setMessage(result.rewardGranted ? `Résolu ! +${result.rewardSp} SP` : 'Résolu !');
        if (result.rewardGranted && user) {
          setUser({ ...user, sp_balance: user.sp_balance + result.rewardSp });
        }
      } else if (result.status === 'lost') {
        setDrafts({});
        setNotes(emptyNotes());
        setSelected(null);
        setFeedback(null);
        sound.playWrong();
        sound.playLose();
      } else if (result.correct) {
        setFeedback({ text: 'Bonne réponse !', tone: 'success' });
        sound.playCorrect();
      } else {
        setFeedback({ text: 'Faux — ça compte comme une erreur.', tone: 'error' });
        sound.playWrong();
      }
    } catch (err) {
      // course (case déjà validée entre-temps, partie perdue…) — on annule la
      // saisie optimiste et on resynchronise avec le serveur plutôt que de
      // laisser l'affichage divergent.
      setDrafts((prev) => {
        if (!(index in prev)) return prev;
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setWrongCells((prev) => {
        if (!prev.has(index)) return prev;
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      setFeedback(null);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      await load();
    } finally {
      setPendingCells((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
    await loadAdminOverview();
  }

  // Une case pleine ne peut pas porter d'annotation (pas de sens à noter des
  // candidats sur une case déjà remplie) ; taper le même chiffre efface la
  // case plutôt que de la resaisir — pratique pour corriger sans passer par
  // le bouton Effacer. Une case verrouillée (indice ou déjà validée) ou en
  // cours de vérification ignore la saisie.
  function applyDigit(digit: number) {
    if (!view || view.status !== 'in_progress' || selected === null) return;
    const index = selected;
    if (isCellLocked(view, index) || pendingCells.has(index)) return;
    const ch = String(digit);

    if (notesMode) {
      if (grid[index] !== '0') return;
      setNotes((prev) => {
        const current = prev[index] ?? '';
        const nextCell = current.includes(ch) ? current.replace(ch, '') : [...current, ch].sort().join('');
        return setAt(prev, index, nextCell);
      });
      return;
    }

    if (grid[index] === ch) {
      setDrafts((prev) => {
        if (!(index in prev)) return prev;
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setWrongCells((prev) => {
        if (!prev.has(index)) return prev;
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      return;
    }

    setNotes((prev) => setAt(prev, index, ''));
    setDrafts((prev) => ({ ...prev, [index]: ch }));
    setWrongCells((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    void submitDigit(index, digit);
  }

  function handleErase() {
    if (!view || view.status !== 'in_progress' || selected === null) return;
    const index = selected;
    if (isCellLocked(view, index) || pendingCells.has(index)) return;
    setNotes((prev) => setAt(prev, index, ''));
    setDrafts((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setWrongCells((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
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
  }, [view, selected, grid, notesMode, pendingCells]);

  const filledCount = useMemo(() => grid.split('').filter((c) => c !== '0').length, [grid]);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-zinc-50">Sudoku</h1>
          <VolumeSlider />
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          Une grille générée automatiquement chaque jour — réinitialisée à minuit. Chaque chiffre saisi est
          vérifié immédiatement.
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
                      {view.maxMistakes[d.value]} erreur{view.maxMistakes[d.value] > 1 ? 's' : ''} max
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-500">
                Difficulté :{' '}
                <span className="text-zinc-300 font-medium">
                  {DIFFICULTIES.find((d) => d.value === view.difficulty)?.label}
                </span>
              </p>
              <span
                className={`text-sm font-bold px-2.5 py-1 rounded-md border ${
                  view.mistakesUsed >= view.maxMistakes
                    ? 'bg-red-500/20 border-red-500/50 text-red-400'
                    : view.mistakesUsed >= view.maxMistakes - 1
                      ? 'bg-red-500/10 border-red-500/30 text-red-400 animate-pulse'
                      : view.mistakesUsed > 0
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                }`}
              >
                {view.mistakesUsed}/{view.maxMistakes} erreur{view.maxMistakes > 1 ? 's' : ''}
              </span>
            </div>

            {feedback && view.status === 'in_progress' && (
              <div
                className={`mb-3 rounded-md px-3 py-2 text-sm font-semibold text-center ${
                  feedback.tone === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}
              >
                {feedback.tone === 'success' ? '✅ ' : '❌ '}
                {feedback.text}
              </div>
            )}

            <div
              className="grid gap-0.5 bg-zinc-700 border-2 border-zinc-600 rounded-md overflow-hidden mb-3"
              style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 81 }, (_, i) => {
                const isGiven = view.givens[i] !== '0';
                const isValidated = view.validated[i] !== '0';
                const hasValue = grid[i] !== '0';
                const wrong = wrongCells.has(i);
                const isSelected = selected === i;
                const isPending = pendingCells.has(i);
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
                    disabled={isGiven || isValidated || view.status !== 'in_progress' || isPending}
                    aria-label={`Case ${row + 1}-${col + 1}`}
                    className={`aspect-square flex items-center justify-center font-semibold text-sm sm:text-base disabled:cursor-default ${
                      isGiven ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-900 text-emerald-400'
                    } ${wrong ? '!bg-red-500/20 !text-red-400' : ''} ${
                      isSelected ? '!bg-emerald-500/20 ring-1 ring-inset ring-emerald-500' : ''
                    } ${isPending ? 'opacity-50' : ''} ${thickRight ? 'border-r-2 border-r-zinc-500' : ''} ${
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
                      disabled={selected === null || pendingCells.has(selected)}
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
                    disabled={selected === null || pendingCells.has(selected)}
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
                Perdu — trop d'erreurs aujourd'hui. La solution est affichée ci-dessus.
              </p>
            )}
            {view.status === 'in_progress' && (
              <p className="text-center text-xs text-zinc-500">
                Récompense : +{view.rewardSp} SP · {filledCount}/81 cases remplies
              </p>
            )}
          </>
        )}

        {user?.role === 'admin' && adminOverview.length > 0 && (
          <div className="mt-10 pt-6 border-t border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">MSP — Grilles du jour</h2>
            <p className="text-xs text-zinc-500 mb-3">
              Génération 100% automatique, rien à créer — ajuste les récompenses et le nombre d'erreurs
              autorisées depuis la page Config.
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
                    <span className="text-zinc-600 flex-shrink-0">
                      L{Math.floor(a.cell_index / 9) + 1}C{(a.cell_index % 9) + 1} = {a.digit}
                    </span>
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
