import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSpectators } from '../hooks/useSpectators.js';
import { useAnnounceChatRoom } from '../hooks/useChatGameRoom.jsx';
import * as rouletteApi from '../api/roulette.js';
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
  RouletteBet,
  RouletteBetType,
  RouletteHistoryEntry,
  RoulettePayoutInfo,
  RouletteRecentNumber,
  RouletteRoundPublicView,
  RouletteRoundStatus,
} from '../types.js';

/** Rouge/noir dérive uniquement de la position physique du numéro sur une roue européenne standard — pas une règle configurable par le MSP, donc pas besoin de la faire porter par le serveur. */
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function numberColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}
function tileClass(n: number): string {
  const c = numberColor(n);
  if (c === 'green') return 'bg-emerald-600 text-white';
  if (c === 'red') return 'bg-rose-600 text-white';
  return 'bg-zinc-800 text-zinc-100';
}
function cellBorderClass(n: number): string {
  const c = numberColor(n);
  if (c === 'green') return 'border-emerald-400';
  if (c === 'red') return 'border-rose-400';
  return 'border-zinc-600';
}
/** Ordre réel des cases d'une roue européenne (zéro unique) — pas 0→36 dans l'ordre, c'est l'ordre physique sur la roue. */
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31,
  9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const POCKETS = WHEEL_ORDER.length;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Géométrie de l'arc, en unités relatives à la largeur mesurée du conteneur :
 * les cases sont posées sur le haut d'un grand cercle dont le centre est sous
 * le cadre, REEL_CELL_DEG degrés par case — 5 cases pleines (centre ± 2) et
 * une case entamée de chaque côté.
 */
const REEL_CELL_DEG = 17;
const REEL_RADIUS_RATIO = 0.62;
const REEL_CELL_W_RATIO = 0.165;
const REEL_CELL_H_RATIO = 0.13;
const REEL_TOP_PAD_RATIO = 0.015;
const REEL_VIEW_H_RATIO = 0.4;

/** Durée totale d'un lancer (accélération + décélération), calée juste sous SPIN_DURATION_SECONDS côté serveur (4 s). */
const REEL_ROLL_S = 3.6;
/** Part de la durée consacrée à l'accélération, le reste est une longue décélération. */
const REEL_ACCEL_SHARE = 0.35;
/** Distance minimale parcourue (en cases) — près d'un tour de roue avant de viser la case gagnante. */
const REEL_MIN_ROLL_CELLS = 30;
/** Intervalle minimal entre deux "tic" : à pleine vitesse, un tic par case saturerait. */
const REEL_TICK_MIN_MS = 45;

/**
 * Profil de position normalisé (0 → 1) : vitesse en s² pendant l'accélération
 * puis en (1-u)² pendant la décélération — vitesse continue au pic, et nulle
 * (avec une accélération nulle) à l'arrivée, pour un arrêt tout en douceur.
 */
function rollProgress(s: number): number {
  const a = REEL_ACCEL_SHARE;
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  if (s < a) return a * (s / a) ** 3;
  const u = (s - a) / (1 - a);
  return a + (1 - a) * (1 - (1 - u) ** 3);
}

type ReelMotion = { kind: 'idle' } | { kind: 'roll'; from: number; distance: number; startedAt: number };

/**
 * Roue en arc horizontal : les cases défilent de droite à gauche le long du
 * haut d'un grand cercle, la case au sommet (sous le repère) est la case
 * tirée. `children` s'affiche au centre de l'arc (statut, compte à rebours).
 *
 * Le numéro gagnant est révélé par le serveur dès que la manche passe
 * `spinning` (mises closes) : la roue fait alors un seul mouvement planifié —
 * accélération, puis longue décélération jusqu'à la case gagnante — en
 * REEL_ROLL_S secondes. La position est fonction du temps écoulé (pas
 * intégrée image par image), donc un onglet en arrière-plan reprend
 * directement au bon endroit.
 */
function RouletteReel({
  status,
  winningNumber,
  onSettled,
  children,
}: {
  status: RouletteRoundStatus | undefined;
  winningNumber: number | null;
  onSettled: () => void;
  children?: ReactNode;
}) {
  const [landed, setLanded] = useState(status === 'finished');
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [offset, setOffset] = useState(() => (winningNumber !== null ? WHEEL_ORDER.indexOf(winningNumber) : 0));
  const offsetRef = useRef(offset);
  const motionRef = useRef<ReelMotion>({ kind: 'idle' });
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const prevStatusRef = useRef<RouletteRoundStatus | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const frame = useCallback((ts: number) => {
    const motion = motionRef.current;
    if (motion.kind !== 'roll') {
      rafRef.current = null;
      return;
    }
    const s = (ts - motion.startedAt) / 1000 / REEL_ROLL_S;
    const before = offsetRef.current;
    const next = motion.from + motion.distance * rollProgress(s);

    if (Math.round(next) !== Math.round(before) && ts - lastTickRef.current >= REEL_TICK_MIN_MS) {
      lastTickRef.current = ts;
      sound.playTick();
    }
    offsetRef.current = next;
    setOffset(next);

    if (s >= 1) {
      motionRef.current = { kind: 'idle' };
      rafRef.current = null;
      setLanded(true);
      onSettledRef.current();
    } else {
      rafRef.current = requestAnimationFrame(frame);
    }
  }, []);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status ?? null;
    // Nouvelle manche : la roue est "réarmée" pour le prochain lancer.
    if (status === 'betting') {
      if (landed) setLanded(false);
      return;
    }
    // Un seul lancer par manche : déjà en cours, ou déjà arrêtée sur la case gagnante.
    if (winningNumber === null || motionRef.current.kind === 'roll' || landed) return;
    if (status !== 'spinning' && status !== 'finished') return;

    const target = WHEEL_ORDER.indexOf(winningNumber);
    const from = offsetRef.current;
    // Lancer si la manche tourne, ou si elle est passée `finished` sous nos yeux (poll
    // qui a raté `spinning`). Arrivée sur une manche déjà terminée (chargement de page) :
    // on se place directement sur la case, sans animation.
    const shouldRoll = status === 'spinning' || prev === 'spinning' || prev === 'betting';
    if (shouldRoll) {
      motionRef.current = {
        kind: 'roll',
        from,
        distance: REEL_MIN_ROLL_CELLS + mod(target - (from + REEL_MIN_ROLL_CELLS), POCKETS),
        startedAt: performance.now(),
      };
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(frame);
    } else {
      const snapped = from + mod(target - from, POCKETS);
      offsetRef.current = snapped;
      setOffset(snapped);
      setLanded(true);
      onSettledRef.current();
    }
  }, [status, winningNumber, frame, landed]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const radius = width * REEL_RADIUS_RATIO;
  const cellW = width * REEL_CELL_W_RATIO;
  const cellH = width * REEL_CELL_H_RATIO;
  const centerX = width / 2;
  const centerY = width * REEL_TOP_PAD_RATIO + cellH / 2 + radius;
  const innerRadius = radius - cellH / 2 - width * 0.03;

  const base = Math.round(offset);
  const cells: ReactNode[] = [];
  for (let i = base - 4; i <= base + 4; i++) {
    // Index croissant = case plus à droite : la roue défile de droite à gauche.
    const d = i - offset;
    const angle = d * REEL_CELL_DEG;
    if (Math.abs(angle) > 75) continue;
    const rad = (angle * Math.PI) / 180;
    const x = centerX + radius * Math.sin(rad);
    const y = centerY - radius * Math.cos(rad);
    const n = WHEEL_ORDER[mod(i, POCKETS)]!;
    const isWinner = landed && Math.abs(d) < 0.5;
    cells.push(
      <div
        key={i}
        className={`absolute left-0 top-0 flex items-center justify-center font-black border-2 transition-[opacity,box-shadow] duration-300 ${tileClass(n)} ${cellBorderClass(n)}`}
        style={{
          width: cellW,
          height: cellH,
          borderRadius: width * 0.028,
          fontSize: cellH * 0.44,
          transform: `translate(${x - cellW / 2}px, ${y - cellH / 2}px) rotate(${angle}deg) scale(${isWinner ? 1.08 : 1})`,
          opacity: landed && !isWinner ? 0.45 : 1,
          boxShadow: isWinner ? '0 0 0 3px #fbbf24, 0 0 24px rgba(251,191,36,0.6)' : '0 4px 10px rgba(0,0,0,0.35)',
          zIndex: isWinner ? 1 : 0,
        }}
      >
        {n}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative mx-auto mb-4 w-full max-w-xl overflow-hidden"
      style={{
        height: width * REEL_VIEW_H_RATIO,
        maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
      }}
    >
      {width > 0 && (
        <>
          {/* Arc intérieur + halo : matérialise le cercle sur lequel tournent les cases. */}
          <div
            className="pointer-events-none absolute rounded-full border-[3px] border-zinc-800"
            style={{
              left: centerX - innerRadius,
              top: centerY - innerRadius,
              width: innerRadius * 2,
              height: innerRadius * 2,
              background: 'radial-gradient(circle at 50% 0%, rgba(63,63,70,0.35), transparent 45%)',
            }}
          />
          {cells}
          <div
            className="pointer-events-none absolute w-0 h-0 -translate-x-1/2 border-l-[9px] border-l-transparent border-r-[9px] border-r-transparent border-b-[12px] border-b-amber-400"
            style={{
              left: centerX,
              top: centerY - innerRadius - 14,
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
            }}
          />
          <div
            className="absolute inset-x-0 flex flex-col items-center justify-center text-center"
            style={{ top: centerY - innerRadius + 8, bottom: 0 }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function secondsUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

const RECENT_NUMBERS_LIMIT = 20;

/** Bandeau des derniers numéros tirés, le plus récent à gauche (animé à son arrivée), fondu à droite. */
function RecentNumbersStrip({ numbers }: { numbers: RouletteRecentNumber[] }) {
  if (numbers.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Derniers tirages</p>
      <div
        className="flex items-center gap-1.5 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to right, black 80%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent)',
        }}
      >
        {numbers.map((r, i) => (
          <span
            key={r.id}
            className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-xs font-bold tabular-nums border ${tileClass(r.winning_number)} ${cellBorderClass(r.winning_number)}`}
            style={i === 0 ? { animation: 'popIn 0.4s ease-out' } : undefined}
          >
            {r.winning_number}
          </span>
        ))}
      </div>
    </div>
  );
}

type Mode = 'simple' | 'advanced';
const MODE_STORAGE_KEY = 'roulette-mode';

function OutsideBetButton({
  label,
  sub,
  mine,
  others,
  disabled,
  onClick,
}: {
  label: string;
  sub?: string;
  mine: number;
  others: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative h-14 rounded-md text-xs font-semibold border transition active:scale-95 disabled:opacity-40 ${
        mine > 0
          ? 'border-amber-400 bg-amber-500/15 text-amber-300'
          : 'border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:border-zinc-600'
      }`}
    >
      <span className="block">{label}</span>
      {sub && <span className="block text-[10px] text-zinc-500">{sub}</span>}
      {mine > 0 && <span className="absolute top-0.5 right-1 text-[10px] bg-black/40 rounded px-1">{mine}</span>}
      {others > 0 && (
        <span className="absolute bottom-0.5 left-1 text-[9px] text-zinc-500">
          {others} joueur{others > 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

export default function Roulette() {
  const { user, setUser } = useAuth();
  const spectators = useSpectators('roulette');
  useAnnounceChatRoom({ room: 'roulette', roomKey: '', label: 'Roulette', icon: '🎡' });

  const [round, setRound] = useState<RouletteRoundPublicView | null>(null);
  const [rouletteEnabled, setRouletteEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [rtp, setRtp] = useState<number | null>(null);
  const [payouts, setPayouts] = useState<RoulettePayoutInfo[]>([]);
  const [history, setHistory] = useState<RouletteHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('all');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      return stored === 'advanced' ? 'advanced' : 'simple';
    } catch {
      return 'simple';
    }
  });
  const [chipAmount, setChipAmount] = useState('1');
  const [straightNumber, setStraightNumber] = useState('0');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [resultPopup, setResultPopup] = useState<{ key: number; amount: number } | null>(null);
  const [reelSettled, setReelSettled] = useState(true);

  const prevStatusRef = useRef<RouletteRoundStatus | null>(null);
  const [recentNumbers, setRecentNumbers] = useState<RouletteRecentNumber[]>([]);

  // Le résultat (son + popup + bandeau des derniers tirages) attend deux choses, dans n'importe
  // quel ordre : l'arrêt de la roue (animation locale) et le passage `finished` côté serveur
  // (gains réglés) — la roue s'arrête en général juste avant la fin de la phase serveur.
  const pendingResultRef = useRef<{ id: number; winning_number: number; net: number | null } | null>(null);
  const reelSettledRef = useRef(true);

  const revealPendingResult = useCallback(() => {
    const pending = pendingResultRef.current;
    if (!pending || !reelSettledRef.current) return;
    pendingResultRef.current = null;
    const { net, ...latest } = pending;
    setRecentNumbers((prev) =>
      prev.some((r) => r.id === latest.id) ? prev : [latest, ...prev].slice(0, RECENT_NUMBERS_LIMIT)
    );
    if (net === null) return;
    if (net > 0) sound.playWin();
    else sound.playLose();
    setResultPopup({ key: Date.now(), amount: net });
    setTimeout(() => setResultPopup(null), 1800);
  }, []);

  const handleReelSettled = useCallback(() => {
    reelSettledRef.current = true;
    setReelSettled(true);
    revealPendingResult();
  }, [revealPendingResult]);

  useEffect(() => {
    rouletteApi.getRecentNumbers(RECENT_NUMBERS_LIMIT).then(setRecentNumbers).catch(() => {});
  }, []);

  function setModeAndPersist(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* stockage indisponible (navigation privée…) — pas bloquant, juste pas persisté */
    }
  }

  const loadHistory = useCallback(() => {
    rouletteApi
      .getHistory(15, historyScope === 'mine')
      .then(setHistory)
      .catch(() => {});
  }, [historyScope]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const load = useCallback(async () => {
    try {
      const result = await rouletteApi.getCurrent();
      setRound(result.round);
      setRouletteEnabled(result.enabled);
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
    const interval = setInterval(load, 1000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    gamblingApi.getStatus().then(setStatus).catch(() => {});
    gamblingApi
      .listGames()
      .then((games) => setRtp(games.find((g) => g.id === 'roulette')?.rtp ?? null))
      .catch(() => {});
    rouletteApi.getPayouts().then(setPayouts).catch(() => {});
  }, []);

  // Réagit aux transitions de phase de la manche courante (son, popup de résultat, rafraîchissement budget/historique) — comparaison au statut précédemment observé, pas au statut brut à chaque poll.
  useEffect(() => {
    if (!round) return;
    const prevStatus = prevStatusRef.current;

    if (round.status === 'spinning' && prevStatus !== 'spinning') {
      reelSettledRef.current = false;
      setReelSettled(false);
    }

    if (round.status === 'finished' && prevStatus !== 'finished') {
      const myBets = round.bets.filter((b) => b.user_id === user?.id);
      if (round.winning_number !== null) {
        pendingResultRef.current = {
          id: round.id,
          winning_number: round.winning_number,
          net: myBets.length > 0 ? myBets.reduce((sum, b) => sum + (b.payout ?? 0) - b.amount, 0) : null,
        };
      }
      revealPendingResult();
      loadHistory();
      gamblingApi.getStatus().then(setStatus).catch(() => {});
    }

    prevStatusRef.current = round.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id, round?.status]);

  const payoutByType = useMemo(() => new Map(payouts.map((p) => [p.type, p] as const)), [payouts]);

  const myBets = useMemo(() => round?.bets.filter((b) => b.user_id === user?.id) ?? [], [round, user?.id]);
  const uniqueBettors = useMemo(() => {
    if (!round) return [];
    const seen = new Map<number, (typeof round.bets)[number]>();
    for (const b of round.bets) if (!seen.has(b.user_id)) seen.set(b.user_id, b);
    return [...seen.values()];
  }, [round]);

  function betAmountAtSpot(type: RouletteBetType, number?: number): number {
    return myBets.find((b) => b.type === type && (b.number ?? null) === (number ?? null))?.amount ?? 0;
  }
  function othersAtSpot(type: RouletteBetType, number?: number): number {
    if (!round) return 0;
    const ids = new Set(
      round.bets
        .filter((b) => b.type === type && (b.number ?? null) === (number ?? null) && b.user_id !== user?.id)
        .map((b) => b.user_id)
    );
    return ids.size;
  }

  const bettingOpen = round?.status === 'betting';
  const secondsLeft = round?.status === 'betting' ? secondsUntil(round.starts_at, now) : 0;
  const chipAmountNum = Math.floor(Number(chipAmount));
  const canAfford = (user?.sp_balance ?? 0) >= (Number.isInteger(chipAmountNum) ? chipAmountNum : 0);
  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);
  const canBet = bettingOpen && rouletteEnabled && !placing && canAfford && Number.isInteger(chipAmountNum) && chipAmountNum > 0;

  async function submitBet(type: RouletteBetType, number?: number) {
    if (!canBet) return;
    sound.unlockAudio();
    sound.playChip();
    setPlacing(true);
    setError(null);
    try {
      const bet: RouletteBet = type === 'straight' ? { type, number, amount: chipAmountNum } : { type, amount: chipAmountNum };
      const result = await rouletteApi.placeBet([bet]);
      setRound(result.round);
      setRouletteEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      gamblingApi.getStatus().then(setStatus).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setPlacing(false);
    }
  }

  function statusLabel(): string {
    if (!round) return '';
    if (round.status === 'betting') {
      return round.starts_at ? 'Mises ouvertes' : 'Pose la première mise pour lancer le tour';
    }
    if (round.status === 'spinning' || !reelSettled) return 'La roue tourne…';
    return 'Résultat';
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/gambling" className="text-sm text-emerald-400 font-medium">
          ← Jeux
        </Link>

        <div className="flex items-center justify-between mt-4 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-50">Roulette</h1>
            {rtp !== null && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                {rtp}% redistribués
              </span>
            )}
          </div>
          <VolumeSlider />
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {!rouletteEnabled && <p className="mb-4 text-sm text-red-400">La Roulette est désactivée par le MSP.</p>}

        <SpectatorsList spectators={spectators} />

        {status && <GamblingBudgetBar status={{ ...status, enabled: rouletteEnabled }} />}

        <div className="rounded-xl shadow-md p-4 mb-4 border-2 border-emerald-500/20 bg-zinc-900/80">
          {loading ? (
            <p className="text-zinc-500 text-center py-8">Chargement…</p>
          ) : (
            <>
              <RecentNumbersStrip numbers={recentNumbers} />

              <RouletteReel
                status={round?.status}
                winningNumber={round?.winning_number ?? null}
                onSettled={handleReelSettled}
              >
                <div className="relative">
                  <p className="text-xs sm:text-sm text-zinc-400">{statusLabel()}</p>
                  {round?.status === 'betting' && round.starts_at && (
                    <p className="text-4xl sm:text-5xl font-black text-zinc-50 tabular-nums mt-1">
                      00:{String(secondsLeft).padStart(2, '0')}
                    </p>
                  )}
                  {round?.status === 'finished' && reelSettled && round.winning_number !== null && (
                    <p className="mt-1.5">
                      <span className={`inline-block text-3xl sm:text-4xl font-black px-3 py-0.5 rounded-lg ${tileClass(round.winning_number)}`}>
                        {round.winning_number}
                      </span>
                    </p>
                  )}
                  {resultPopup && (
                    <p
                      key={resultPopup.key}
                      className={`absolute left-1/2 -translate-x-1/2 -top-8 text-2xl font-black whitespace-nowrap ${resultPopup.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      style={{ animation: 'floatUp 1.8s ease-out forwards' }}
                    >
                      {resultPopup.amount > 0 ? `+${resultPopup.amount}` : resultPopup.amount} SP
                    </p>
                  )}
                </div>
              </RouletteReel>

              {uniqueBettors.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-center mb-4 text-xs text-zinc-500">
                  <span>Misent en ce moment :</span>
                  {uniqueBettors.map((b) => (
                    <span key={b.user_id} className="flex items-center gap-1">
                      <Avatar
                        username={b.username}
                        avatarUrl={b.avatar_url}
                        size={20}
                        frameUrl={b.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                      />
                      <UserNameTag
                        username={b.user_id === user?.id ? 'Toi' : b.username}
                        equipped={b.equipped_cosmetics}
                        className="text-xs text-zinc-400"
                      />
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={chipAmount}
                    onChange={(e) => setChipAmount(e.target.value)}
                    disabled={!bettingOpen}
                    placeholder="Jeton (SP)"
                    className="w-28 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                  />
                  {chipAmountNum > 0 && !canAfford && <span className="text-xs text-red-400">Solde insuffisant</span>}
                </div>
                <div className="flex items-center gap-0.5 bg-zinc-950 border border-zinc-800 rounded-full p-0.5">
                  <button
                    type="button"
                    onClick={() => setModeAndPersist('simple')}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${mode === 'simple' ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    Simple
                  </button>
                  <button
                    type="button"
                    onClick={() => setModeAndPersist('advanced')}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${mode === 'advanced' ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    Avancé
                  </button>
                </div>
              </div>

              {mode === 'simple' ? (
                <div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <OutsideBetButton
                      label="Rouge"
                      sub={payoutByType.get('red') ? `x${payoutByType.get('red')!.multiplier_x100 / 100}` : undefined}
                      mine={betAmountAtSpot('red')}
                      others={othersAtSpot('red')}
                      disabled={!canBet}
                      onClick={() => submitBet('red')}
                    />
                    <OutsideBetButton
                      label="Noir"
                      sub={payoutByType.get('black') ? `x${payoutByType.get('black')!.multiplier_x100 / 100}` : undefined}
                      mine={betAmountAtSpot('black')}
                      others={othersAtSpot('black')}
                      disabled={!canBet}
                      onClick={() => submitBet('black')}
                    />
                    <OutsideBetButton
                      label="Pair"
                      sub={payoutByType.get('even') ? `x${payoutByType.get('even')!.multiplier_x100 / 100}` : undefined}
                      mine={betAmountAtSpot('even')}
                      others={othersAtSpot('even')}
                      disabled={!canBet}
                      onClick={() => submitBet('even')}
                    />
                    <OutsideBetButton
                      label="Impair"
                      sub={payoutByType.get('odd') ? `x${payoutByType.get('odd')!.multiplier_x100 / 100}` : undefined}
                      mine={betAmountAtSpot('odd')}
                      others={othersAtSpot('odd')}
                      disabled={!canBet}
                      onClick={() => submitBet('odd')}
                    />
                    <OutsideBetButton
                      label="1-18"
                      sub={payoutByType.get('low') ? `x${payoutByType.get('low')!.multiplier_x100 / 100}` : undefined}
                      mine={betAmountAtSpot('low')}
                      others={othersAtSpot('low')}
                      disabled={!canBet}
                      onClick={() => submitBet('low')}
                    />
                    <OutsideBetButton
                      label="19-36"
                      sub={payoutByType.get('high') ? `x${payoutByType.get('high')!.multiplier_x100 / 100}` : undefined}
                      mine={betAmountAtSpot('high')}
                      others={othersAtSpot('high')}
                      disabled={!canBet}
                      onClick={() => submitBet('high')}
                    />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="number"
                      min={0}
                      max={36}
                      value={straightNumber}
                      onChange={(e) => setStraightNumber(e.target.value)}
                      disabled={!bettingOpen}
                      className="w-20 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    />
                    <button
                      type="button"
                      disabled={!canBet || !Number.isInteger(Number(straightNumber)) || Number(straightNumber) < 0 || Number(straightNumber) > 36}
                      onClick={() => submitBet('straight', Math.floor(Number(straightNumber)))}
                      className="flex-1 h-10 rounded-md border border-zinc-700 bg-zinc-800/60 text-zinc-200 text-sm font-semibold hover:border-zinc-600 disabled:opacity-40 transition active:scale-95"
                    >
                      Miser sur ce numéro plein ({payoutByType.get('straight') ? `x${payoutByType.get('straight')!.multiplier_x100 / 100}` : '…'})
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <Section title="Numéros">
                    <button
                      type="button"
                      disabled={!canBet}
                      onClick={() => submitBet('straight', 0)}
                      className={`relative w-full h-9 rounded-md font-bold mb-1.5 text-sm transition active:scale-95 disabled:opacity-40 ${tileClass(0)}`}
                    >
                      0
                      {betAmountAtSpot('straight', 0) > 0 && (
                        <span className="absolute top-0.5 right-1 text-[10px] bg-black/40 rounded px-1">{betAmountAtSpot('straight', 0)}</span>
                      )}
                    </button>
                    <div className="grid grid-cols-6 gap-1">
                      {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          disabled={!canBet}
                          onClick={() => submitBet('straight', n)}
                          className={`relative h-9 rounded-md font-bold text-xs transition active:scale-95 disabled:opacity-40 hover:ring-1 hover:ring-amber-400/60 ${tileClass(n)}`}
                        >
                          {n}
                          {betAmountAtSpot('straight', n) > 0 && (
                            <span className="absolute top-0 right-0.5 text-[9px] bg-black/40 rounded px-1">{betAmountAtSpot('straight', n)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </Section>

                  <Section title="Couleur">
                    <div className="grid grid-cols-2 gap-1.5">
                      <OutsideBetButton label="Rouge" mine={betAmountAtSpot('red')} others={othersAtSpot('red')} disabled={!canBet} onClick={() => submitBet('red')} />
                      <OutsideBetButton label="Noir" mine={betAmountAtSpot('black')} others={othersAtSpot('black')} disabled={!canBet} onClick={() => submitBet('black')} />
                    </div>
                  </Section>

                  <Section title="Parité">
                    <div className="grid grid-cols-2 gap-1.5">
                      <OutsideBetButton label="Pair" mine={betAmountAtSpot('even')} others={othersAtSpot('even')} disabled={!canBet} onClick={() => submitBet('even')} />
                      <OutsideBetButton label="Impair" mine={betAmountAtSpot('odd')} others={othersAtSpot('odd')} disabled={!canBet} onClick={() => submitBet('odd')} />
                    </div>
                  </Section>

                  <Section title="Plage">
                    <div className="grid grid-cols-2 gap-1.5">
                      <OutsideBetButton label="Manque (1-18)" mine={betAmountAtSpot('low')} others={othersAtSpot('low')} disabled={!canBet} onClick={() => submitBet('low')} />
                      <OutsideBetButton label="Passe (19-36)" mine={betAmountAtSpot('high')} others={othersAtSpot('high')} disabled={!canBet} onClick={() => submitBet('high')} />
                    </div>
                  </Section>

                  <Section title="Douzaines">
                    <div className="grid grid-cols-3 gap-1.5">
                      <OutsideBetButton label="1ère (1-12)" mine={betAmountAtSpot('dozen1')} others={othersAtSpot('dozen1')} disabled={!canBet} onClick={() => submitBet('dozen1')} />
                      <OutsideBetButton label="2ème (13-24)" mine={betAmountAtSpot('dozen2')} others={othersAtSpot('dozen2')} disabled={!canBet} onClick={() => submitBet('dozen2')} />
                      <OutsideBetButton label="3ème (25-36)" mine={betAmountAtSpot('dozen3')} others={othersAtSpot('dozen3')} disabled={!canBet} onClick={() => submitBet('dozen3')} />
                    </div>
                  </Section>

                  <Section title="Colonnes">
                    <div className="grid grid-cols-3 gap-1.5">
                      <OutsideBetButton label="Colonne 1" mine={betAmountAtSpot('col1')} others={othersAtSpot('col1')} disabled={!canBet} onClick={() => submitBet('col1')} />
                      <OutsideBetButton label="Colonne 2" mine={betAmountAtSpot('col2')} others={othersAtSpot('col2')} disabled={!canBet} onClick={() => submitBet('col2')} />
                      <OutsideBetButton label="Colonne 3" mine={betAmountAtSpot('col3')} others={othersAtSpot('col3')} disabled={!canBet} onClick={() => submitBet('col3')} />
                    </div>
                  </Section>
                </div>
              )}

              {myBets.length > 0 && (
                <div className="mt-2 pt-3 border-t border-zinc-800">
                  <p className="text-xs text-zinc-500 mb-1.5">Mes mises ce tour ({myBets.reduce((s, b) => s + b.amount, 0)} SP) :</p>
                  <div className="flex flex-wrap gap-1.5">
                    {myBets.map((b) => (
                      <span key={b.id} className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {b.type === 'straight' ? `N°${b.number}` : payoutByType.get(b.type)?.label ?? b.type} — {b.amount} SP
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-500 mt-3 text-center">Il te reste {budgetLeft} SP de budget gambling aujourd'hui.</p>
            </>
          )}
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase">Historique</h2>
            <HistoryScopeToggle scope={historyScope} onChange={setHistoryScope} />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune manche pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const net = (h.payout ?? 0) - h.amount;
                return (
                  <li key={h.id} className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar
                        username={h.username}
                        avatarUrl={h.avatar_url}
                        size={24}
                        frameUrl={h.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                      />
                      <div className="min-w-0">
                        <p className="truncate flex items-center gap-1">
                          <UserNameTag username={h.user_id === user?.id ? 'Toi' : h.username} equipped={h.equipped_cosmetics} className="text-zinc-300" />
                          <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${tileClass(h.winning_number)}`}>
                            {h.winning_number}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500">
                          {h.type === 'straight' ? `N°${h.number}` : payoutByType.get(h.type)?.label ?? h.type} · {h.amount} SP
                        </p>
                      </div>
                    </div>
                    <span className={`font-semibold flex-shrink-0 ${net > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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
