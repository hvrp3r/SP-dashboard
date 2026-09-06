import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSpectators } from '../hooks/useSpectators.js';
import * as towerApi from '../api/tower.js';
import * as gamblingApi from '../api/gambling.js';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import SpectatorsList from '../components/SpectatorsList.jsx';
import HistoryScopeToggle, { type HistoryScope } from '../components/HistoryScopeToggle.jsx';
import * as sound from '../lib/sound.js';
import type {
  GamblingStatus,
  TowerDifficulty,
  TowerDifficultyInfo,
  TowerGame,
  TowerHistoryEntry,
} from '../types.js';

/**
 * Chaque classe Tailwind est écrite ici en toutes lettres (jamais reconstruite
 * par concaténation dans le JSX) : le scanner JIT de Tailwind détecte les
 * classes par correspondance de texte littéral dans les sources, pas en
 * exécutant le JS — une classe assemblée à l'exécution (ex: `` `border-${x}/30` ``)
 * ne serait jamais générée dans le CSS final.
 */
interface DifficultyTheme {
  label: string;
  text: string;
  border: string;
  activeBg: string;
  formBorder: string;
  ring: string;
  solidBg: string;
  glow: string;
}

const DIFFICULTY_THEME: Record<TowerDifficulty, DifficultyTheme> = {
  easy: {
    label: 'Facile',
    text: 'text-emerald-400',
    border: 'border-emerald-500',
    activeBg: 'bg-emerald-500/15',
    formBorder: 'border-emerald-500/30',
    ring: 'ring-emerald-500/60',
    solidBg: 'bg-emerald-500 hover:bg-emerald-400',
    glow: 'rgba(52, 211, 153, 0.45)',
  },
  medium: {
    label: 'Moyen',
    text: 'text-amber-400',
    border: 'border-amber-500',
    activeBg: 'bg-amber-500/15',
    formBorder: 'border-amber-500/30',
    ring: 'ring-amber-500/60',
    solidBg: 'bg-amber-500 hover:bg-amber-400',
    glow: 'rgba(251, 191, 36, 0.45)',
  },
  hard: {
    label: 'Difficile',
    text: 'text-rose-400',
    border: 'border-rose-500',
    activeBg: 'bg-rose-500/15',
    formBorder: 'border-rose-500/30',
    ring: 'ring-rose-500/60',
    solidBg: 'bg-rose-500 hover:bg-rose-400',
    glow: 'rgba(251, 113, 133, 0.45)',
  },
};

function formatX100(x100: number): string {
  return (x100 / 100).toFixed(2);
}

/** Dégradé vert (base de la tour) -> rouge (sommet) selon la hauteur relative de l'étage — purement visuel. */
function riskHue(t: number): number {
  return 130 * (1 - Math.min(1, Math.max(0, t)));
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

export default function Tower() {
  const { user, setUser } = useAuth();
  const spectators = useSpectators('tower');
  const [game, setGame] = useState<TowerGame | null>(null);
  const [difficulties, setDifficulties] = useState<TowerDifficultyInfo[]>([]);
  const [towerEnabled, setTowerEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [rtp, setRtp] = useState<number | null>(null);
  const [history, setHistory] = useState<TowerHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('all');

  const [difficulty, setDifficulty] = useState<TowerDifficulty>('easy');
  const [betAmount, setBetAmount] = useState('');
  const [starting, setStarting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [resultPopup, setResultPopup] = useState<{ key: number; amount: number } | null>(null);

  const loadHistory = useCallback(() => {
    towerApi
      .getHistory(10, historyScope === 'mine')
      .then(setHistory)
      .catch(() => {});
  }, [historyScope]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const load = useCallback(async () => {
    try {
      const result = await towerApi.getCurrentGame();
      setGame(result.game);
      setTowerEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    gamblingApi.getStatus().then(setStatus).catch(() => {});
    gamblingApi
      .listGames()
      .then((games) => setRtp(games.find((g) => g.id === 'tower')?.rtp ?? null))
      .catch(() => {});
    towerApi.getDifficulties().then(setDifficulties).catch(() => {});
  }, []);

  const infoByDifficulty = useMemo(
    () => new Map(difficulties.map((d) => [d.difficulty, d] as const)),
    [difficulties]
  );

  // Structure de la grille : celle de la partie en cours si elle existe, sinon
  // l'aperçu (vierge) de la difficulté sélectionnée — la tour reste donc
  // toujours affichée, avant même la première mise.
  const gridDifficulty = game?.difficulty ?? difficulty;
  const previewInfo = infoByDifficulty.get(gridDifficulty);
  const gridFloors = game?.total_floors ?? previewInfo?.floors ?? 0;
  const gridCells = game?.cells_per_floor ?? previewInfo?.cells_per_floor ?? 0;
  const gridMultipliers = game?.multipliers_x100 ?? previewInfo?.multipliers_x100 ?? [];
  const theme = DIFFICULTY_THEME[gridDifficulty];
  const selectedInfo = infoByDifficulty.get(difficulty);

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    sound.unlockAudio();
    const amount = Number(betAmount);
    if (!Number.isInteger(amount) || amount <= 0) return;
    setStarting(true);
    setError(null);
    try {
      const result = await towerApi.startGame(difficulty, amount);
      setGame(result.game);
      setTowerEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      // La mise n'est volontairement pas réinitialisée : elle reste pré-remplie
      // avec la dernière valeur utilisée pour la partie suivante.
      gamblingApi.getStatus().then(setStatus).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setStarting(false);
    }
  }

  async function handlePick(cell: number) {
    if (!game || picking || game.status !== 'in_progress') return;
    sound.unlockAudio();
    const prevLevel = game.current_level;
    setPicking(true);
    setError(null);
    try {
      const result = await towerApi.pick(cell);
      setGame(result.game);
      setTowerEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      if (result.game?.status === 'busted') {
        sound.playLose();
        loadHistory();
      } else if (result.game?.status === 'cashed_out') {
        sound.playWin();
        const net = (result.game.payout ?? 0) - result.game.bet_amount;
        setResultPopup({ key: Date.now(), amount: net });
        setTimeout(() => setResultPopup(null), 1200);
        loadHistory();
      } else if (result.game && result.game.current_level > prevLevel) {
        sound.playChip();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setPicking(false);
    }
  }

  async function handleCashOut() {
    sound.unlockAudio();
    setCashingOut(true);
    setError(null);
    try {
      const result = await towerApi.cashOut();
      setGame(result.game);
      setTowerEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      sound.playCashRegister();
      if (result.game) {
        const net = (result.game.payout ?? 0) - result.game.bet_amount;
        setResultPopup({ key: Date.now(), amount: net });
        setTimeout(() => setResultPopup(null), 1200);
      }
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCashingOut(false);
    }
  }

  const canAfford = (user?.sp_balance ?? 0) >= (Number(betAmount) || 0);
  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);
  const canCashOut = game?.status === 'in_progress' && game.current_level >= 1;
  const gameOver = !!game && game.status !== 'in_progress';
  const estimatedCashout = game ? Math.floor((game.bet_amount * game.current_multiplier_x100) / 100) : 0;

  // Mise utilisée pour afficher le gain SP directement sur chaque case : celle
  // de la partie en cours, sinon celle tapée dans le formulaire (aperçu en
  // direct avant même de démarrer). `null` tant qu'aucune mise valide n'est
  // connue — les cases affichent alors le multiplicateur à la place.
  const typedBetAmount = Math.floor(Number(betAmount));
  const previewBetAmount = Number.isInteger(typedBetAmount) && typedBetAmount > 0 ? typedBetAmount : null;
  const effectiveBetAmount = game?.bet_amount ?? previewBetAmount;

  // Couleur du cadre partagé (tour + difficulté/mise) : celle du statut de la
  // partie en cours, sinon celle de la difficulté sélectionnée pour la mise.
  const frameBorderColor = !game
    ? theme.glow
    : game.status === 'busted'
      ? 'rgba(244,63,94,0.5)'
      : game.status === 'cashed_out'
        ? 'rgba(52,211,153,0.5)'
        : theme.glow;

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/gambling" className="text-sm text-emerald-400 font-medium">
          ← Jeux
        </Link>

        <div className="flex items-center justify-between mt-4 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-50">Tower</h1>
            {rtp !== null && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                {rtp}% redistribués
              </span>
            )}
          </div>
          <VolumeSlider />
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <SpectatorsList spectators={spectators} />

        {status && <GamblingBudgetBar status={{ ...status, enabled: towerEnabled }} />}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            {gridFloors > 0 && (
              <div
                className="rounded-xl shadow-md p-4 mb-4 border-2 bg-zinc-900/80 transition-colors"
                style={{ borderColor: frameBorderColor }}
              >
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: gridFloors }, (_, i) => i)
                  .reverse()
                  .map((i) => {
                    const isCurrent = !!game && game.status === 'in_progress' && i === game.current_level;
                    const isCleared = !!game && i < game.current_level;
                    const mines = game ? (game.mine_positions[i] ?? null) : null;
                    const myPick = game ? (game.picks[i] ?? null) : null;
                    const rowMultiplier = gridMultipliers[i + 1] as number;
                    const hue = riskHue(gridFloors > 1 ? i / (gridFloors - 1) : 0);
                    const rowTint =
                      !isCurrent && !isCleared
                        ? {
                            borderColor: `hsla(${hue}, 70%, 50%, 0.3)`,
                            backgroundColor: `hsla(${hue}, 70%, 50%, 0.06)`,
                          }
                        : undefined;

                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2 rounded-lg border p-2 transition ${
                          isCurrent
                            ? `border-2 ${theme.border} bg-white/[0.04]`
                            : isCleared
                              ? 'border-zinc-700 bg-zinc-800/40'
                              : 'border-zinc-800/70'
                        }`}
                        style={{
                          ...rowTint,
                          boxShadow: isCurrent ? `0 0 16px -3px ${theme.glow}` : undefined,
                        }}
                      >
                        <span
                          className="text-xs w-14 flex-shrink-0 tabular-nums font-bold"
                          style={
                            isCleared
                              ? { color: '#6ee7b7' }
                              : isCurrent
                                ? undefined
                                : { color: `hsl(${hue}, 65%, 62%)` }
                          }
                        >
                          {formatX100(rowMultiplier)}x
                        </span>
                        <div className={`grid gap-1.5 flex-1 ${gridCells === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                          {Array.from({ length: gridCells }, (_, c) => c).map((cell) => {
                            const isMine = mines?.includes(cell) ?? false;
                            const isPicked = myPick === cell;
                            const revealed = mines !== null;
                            const interactive = isCurrent;
                            const rowGainSp =
                              effectiveBetAmount !== null
                                ? Math.floor((effectiveBetAmount * rowMultiplier) / 100)
                                : null;
                            let content: string;
                            let cellClass: string;
                            if (revealed) {
                              if (isPicked && isMine) {
                                content = '💥';
                                cellClass = 'bg-red-500/25 text-red-300 ring-1 ring-red-500/60';
                              } else if (isPicked && !isMine) {
                                content = '💎';
                                cellClass = 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50';
                              } else if (isMine) {
                                content = '💣';
                                cellClass = 'bg-zinc-800/80 text-zinc-500';
                              } else {
                                content = '';
                                cellClass = 'bg-zinc-800/30 text-zinc-700';
                              }
                            } else {
                              // Case pas encore révélée : affiche le gain SP concret pour cette
                              // mise (ou le multiplicateur si aucune mise n'est encore connue).
                              content = rowGainSp !== null ? `${rowGainSp} SP` : `${formatX100(rowMultiplier)}x`;
                              cellClass = interactive
                                ? 'bg-zinc-800 text-zinc-200 hover:bg-emerald-500/20 hover:text-emerald-400'
                                : 'bg-zinc-800/50 text-zinc-500';
                            }
                            return (
                              <button
                                key={cell}
                                type="button"
                                disabled={!interactive || picking}
                                onClick={() => handlePick(cell)}
                                className={`h-11 rounded-md font-bold text-xs sm:text-sm flex items-center justify-center gap-0.5 px-1 border transition ${cellClass} ${
                                  interactive
                                    ? 'border-white/10 active:scale-95 cursor-pointer'
                                    : 'border-transparent cursor-default'
                                }`}
                              >
                                {content}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-800">
                {!game ? (
                  <form onSubmit={handleStart}>
                    <p className="text-sm font-medium text-zinc-200 mb-3">Choisis ta difficulté</p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {(Object.keys(DIFFICULTY_THEME) as TowerDifficulty[]).map((d) => {
                        const t = DIFFICULTY_THEME[d];
                        const selected = difficulty === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDifficulty(d)}
                            className={`rounded-lg border-2 px-2 py-2.5 text-sm font-bold transition ${
                              selected
                                ? `${t.border} ${t.activeBg} ${t.text}`
                                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                            }`}
                            style={selected ? { boxShadow: `0 0 14px -3px ${t.glow}` } : undefined}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-zinc-500 mb-4">
                      {selectedInfo
                        ? `${pluralize(selectedInfo.mines_per_floor, 'mine')} sur ${pluralize(selectedInfo.cells_per_floor, 'case')} par étage · ${pluralize(selectedInfo.floors, 'étage')}`
                        : 'Chargement…'}
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={1}
                        required
                        placeholder="Mise (SP)"
                        value={betAmount}
                        onChange={(e) => setBetAmount(e.target.value)}
                        className={`flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 ${theme.ring}`}
                      />
                      <button
                        type="submit"
                        disabled={starting || !betAmount || !canAfford || !towerEnabled}
                        className={`font-semibold px-4 py-2 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 text-zinc-950 ${DIFFICULTY_THEME[difficulty].solidBg}`}
                      >
                        {starting ? 'Démarrage…' : 'Démarrer'}
                      </button>
                    </div>
                    {betAmount && !canAfford && (
                      <p className="text-xs text-red-400 mt-2">Solde SP insuffisant.</p>
                    )}
                    <p className="text-xs text-zinc-500 mt-2">
                      Il te reste {budgetLeft} SP de budget gambling aujourd'hui.
                    </p>
                  </form>
                ) : (
                  <div className="relative text-center">
                    <p className={`text-xs uppercase tracking-wide mb-1 font-semibold ${theme.text}`}>
                      {theme.label} · Mise {game.bet_amount} SP
                    </p>
                    <p
                      className={`text-4xl font-black tabular-nums ${
                        game.status === 'busted'
                          ? 'text-red-400'
                          : game.status === 'cashed_out'
                            ? 'text-emerald-400'
                            : theme.text
                      }`}
                      style={{ textShadow: `0 0 22px ${theme.glow}` }}
                    >
                      {formatX100(game.current_multiplier_x100)}x
                    </p>
                    {game.status === 'in_progress' && game.next_multiplier_x100 !== null && (
                      <p className="text-xs text-zinc-500 mt-1">
                        Étage suivant : {formatX100(game.next_multiplier_x100)}x
                      </p>
                    )}
                    {game.status === 'busted' && (
                      <p className="text-sm text-red-400 font-medium mt-1">💥 Mine touchée — mise perdue</p>
                    )}
                    {game.status === 'cashed_out' && (
                      <p className="text-sm text-emerald-400 font-medium mt-1">
                        Retiré — +{(game.payout ?? 0) - game.bet_amount} SP
                      </p>
                    )}
                    {resultPopup && (
                      <p
                        key={resultPopup.key}
                        className="absolute left-1/2 -translate-x-1/2 bottom-[70%] text-2xl font-black text-emerald-400"
                        style={{ animation: 'floatUp 1.2s ease-out forwards' }}
                      >
                        +{resultPopup.amount} SP
                      </p>
                    )}
                  </div>
                )}
              </div>
              </div>
            )}

            {canCashOut && (
              <button
                onClick={handleCashOut}
                disabled={cashingOut || picking}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-3 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 mb-4"
                style={{ animation: 'softPulse 1s ease-in-out infinite' }}
              >
                {cashingOut ? 'Retrait…' : `Retirer (${estimatedCashout} SP)`}
              </button>
            )}

            {gameOver && (
              <button
                onClick={() => setGame(null)}
                className="w-full border border-zinc-700 hover:border-zinc-600 text-zinc-300 font-semibold px-4 py-2.5 rounded-md transition mb-4"
              >
                Nouvelle partie
              </button>
            )}
          </>
        )}

        <div className="mt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase">Historique des parties</h2>
            <HistoryScopeToggle scope={historyScope} onChange={setHistoryScope} />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune partie pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const net = h.status === 'cashed_out' ? h.payout - h.bet_amount : -h.bet_amount;
                const t = DIFFICULTY_THEME[h.difficulty];
                return (
                  <li
                    key={h.id}
                    className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar
                        username={h.username}
                        avatarUrl={h.avatar_url}
                        size={24}
                        frameUrl={h.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                      />
                      <div className="min-w-0">
                        <p className="truncate flex items-center gap-1">
                          <UserNameTag
                            username={h.user_id === user?.id ? 'Toi' : h.username}
                            equipped={h.equipped_cosmetics}
                            className="text-zinc-300"
                          />
                          <span className={`font-semibold ${t.text}`}>{t.label}</span>
                          {h.status === 'cashed_out' && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                              {formatX100(h.final_multiplier_x100)}x
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">
                          Mise {h.bet_amount} SP · Étage {h.current_level}/{h.total_floors}
                          {h.status === 'busted' ? ' — mine touchée' : ''}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-semibold flex-shrink-0 ${net > 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {net > 0 ? `+${net} SP` : `${net} SP`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
