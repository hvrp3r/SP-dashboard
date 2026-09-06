import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSpectators } from '../hooks/useSpectators.js';
import * as crashApi from '../api/crash.js';
import * as gamblingApi from '../api/gambling.js';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import SpectatorsList from '../components/SpectatorsList.jsx';
import HistoryScopeToggle, { type HistoryScope } from '../components/HistoryScopeToggle.jsx';
import * as sound from '../lib/sound.js';
import { syncServerClock, getServerNow } from '../lib/serverClock.js';
import type { CrashBet, CrashHistoryEntry, CrashRound, GamblingStatus } from '../types.js';

const POLL_INTERVAL_MS = 1000;
/** Sondage plus rapide pendant le vol, pour réduire le délai entre l'instant réel
 * du crash côté serveur et le moment où le client l'affiche (jusqu'à POLL_INTERVAL_MS
 * de latence dans le pire cas sinon, puisque l'état n'avance qu'à la lecture). Descendu
 * de 300 à 150ms : le retrait manuel reste plafonné côté serveur au point de crash exact
 * (jamais de sur-paiement), et le retrait automatique est désormais payé à l'instant réel
 * demandé plutôt qu'au multiplicateur constaté au sondage (voir crash.service.ts) — ce
 * sondage plus fréquent ne fait donc que réduire le délai purement visuel d'affichage du
 * crash et du solde, sans risque économique supplémentaire. */
const POLL_INTERVAL_RUNNING_MS = 150;
/** Rafraîchissement rapide, uniquement pendant le vol, pour une animation fluide du multiplicateur entre deux sondages. */
const TICK_INTERVAL_MS = 100;
const GRAPH_WIDTH = 500;
const GRAPH_HEIGHT = 220;

/**
 * Doit rester identique à `GROWTH_PER_SECOND`/`multiplierAt` côté serveur
 * (`crash.service.ts`) — cette formule n'anime que l'affichage entre deux
 * sondages à partir du seul `started_at` renvoyé par le serveur ; le serveur
 * reste seul juge de l'instant réel du crash et du montant payé à un retrait.
 */
const GROWTH_PER_SECOND = 0.1;

function multiplierAt(elapsedSeconds: number): number {
  return Math.exp(GROWTH_PER_SECOND * Math.max(0, elapsedSeconds));
}

function formatX100(x100: number): string {
  return (x100 / 100).toFixed(2);
}

function secondsUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

function netResult(bet: Pick<CrashBet, 'bet_amount' | 'cashout_multiplier_x100'>, crashed: boolean): number {
  if (bet.cashout_multiplier_x100 !== null) {
    return Math.floor((bet.bet_amount * bet.cashout_multiplier_x100) / 100) - bet.bet_amount;
  }
  return crashed ? -bet.bet_amount : 0;
}

const COLOR_START = { r: 248, g: 113, b: 113 }; // red-400 — à x1
const COLOR_END = { r: 52, g: 211, b: 153 }; // emerald-400 — à partir de COLOR_TRANSITION_MULTIPLIER
/** Multiplicateur à partir duquel la couleur est intégralement verte. */
const COLOR_TRANSITION_MULTIPLIER = 4;

/**
 * Couleur du multiplicateur (courbe, fusée, texte) : rouge à x1, qui vire au vert
 * au fil de la montée (interpolation sur échelle logarithmique, plus cohérente
 * avec la perception d'une croissance exponentielle qu'une interpolation linéaire).
 * Objectif volontairement psychologique : le rouge de départ pousse à attendre
 * le vert plutôt que de se retirer immédiatement — purement cosmétique, ça ne
 * change rien à la probabilité réelle de crash (fixée dès la création de la manche).
 */
function multiplierColorChannels(m: number): { r: number; g: number; b: number } {
  const t = Math.min(1, Math.max(0, Math.log(Math.max(m, 1)) / Math.log(COLOR_TRANSITION_MULTIPLIER)));
  return {
    r: Math.round(COLOR_START.r + (COLOR_END.r - COLOR_START.r) * t),
    g: Math.round(COLOR_START.g + (COLOR_END.g - COLOR_START.g) * t),
    b: Math.round(COLOR_START.b + (COLOR_END.b - COLOR_START.b) * t),
  };
}

function multiplierColor(m: number): string {
  const { r, g, b } = multiplierColorChannels(m);
  return `rgb(${r}, ${g}, ${b})`;
}

function multiplierGlow(m: number, alpha: number): string {
  const { r, g, b } = multiplierColorChannels(m);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const HEARTBEAT_MAX_MULTIPLIER = 10;
const HEARTBEAT_START_SECONDS = 1.1; // durée d'un battement à x1 (calme)
const HEARTBEAT_END_SECONDS = 0.32; // durée au plus rapide, dès HEARTBEAT_MAX_MULTIPLIER atteint

/**
 * Durée d'un battement (visuel ET sonore), en secondes — décroît avec le
 * multiplicateur sur la même échelle logarithmique que `multiplierColor`, pour
 * une accélération perçue comme régulière malgré la croissance exponentielle.
 */
function heartbeatDuration(m: number): number {
  const t = Math.min(1, Math.max(0, Math.log(Math.max(m, 1)) / Math.log(HEARTBEAT_MAX_MULTIPLIER)));
  return HEARTBEAT_START_SECONDS + (HEARTBEAT_END_SECONDS - HEARTBEAT_START_SECONDS) * t;
}

interface CurvePoint {
  x: number;
  y: number;
}

/** Points de la courbe, rééchelonnés à chaque tick pour toujours remplir le cadre. */
function curvePoints(elapsedSeconds: number, currentMultiplier: number): CurvePoint[] {
  if (elapsedSeconds <= 0 || currentMultiplier <= 1) {
    return [
      { x: 0, y: GRAPH_HEIGHT },
      { x: 0, y: GRAPH_HEIGHT },
    ];
  }
  const steps = 40;
  const points: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (elapsedSeconds * i) / steps;
    const m = multiplierAt(t);
    const x = (t / elapsedSeconds) * GRAPH_WIDTH;
    const y = GRAPH_HEIGHT - ((m - 1) / (currentMultiplier - 1)) * GRAPH_HEIGHT;
    points.push({ x, y });
  }
  return points;
}

function pointsToPath(points: CurvePoint[]): string {
  return `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
}

/**
 * Ramène un pourcentage de position (fusée/explosion) à l'intérieur d'une marge
 * de sécurité — sans ça, un point exactement sur un bord (ex : le crash "instantané"
 * à 1.00x, dont la trajectoire dégénère en un point unique à l'origine) place l'emoji
 * pile sur le bord du cadre, et la moitié de son icône est rognée par l'`overflow-hidden`
 * du conteneur (translate(-50%, -50%) le centre sur ce point).
 */
function clampPercent(value: number, margin: number): number {
  return Math.min(100 - margin, Math.max(margin, value));
}

export default function Crash() {
  const { user, setUser } = useAuth();
  const spectators = useSpectators('crash');
  const [round, setRound] = useState<CrashRound | null>(null);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [crashEnabled, setCrashEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(getServerNow);
  const [shaking, setShaking] = useState(false);
  const [cashoutPopup, setCashoutPopup] = useState<{ key: number; amount: number } | null>(null);
  // Coupe-circuit du détecteur de retrait automatique pendant un retrait manuel en
  // vol : celui-ci affiche déjà son propre popup/son, un ref (plutôt qu'un state)
  // pour rester à jour de façon synchrone sans dépendre de l'ordre de traitement
  // des mises à jour de state par React.
  const manualCashoutRef = useRef(false);

  const [betAmount, setBetAmount] = useState('');
  const [autoCashout, setAutoCashout] = useState('');
  const [autoCashoutEdit, setAutoCashoutEdit] = useState('');
  const [savingAutoCashout, setSavingAutoCashout] = useState(false);
  const [betting, setBetting] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [history, setHistory] = useState<CrashHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('all');
  const [rtp, setRtp] = useState<number | null>(null);

  const loadHistory = useCallback(() => {
    crashApi
      .getHistory(10, historyScope === 'mine')
      .then(setHistory)
      .catch(() => {});
  }, [historyScope]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const load = useCallback(async () => {
    try {
      const result = await crashApi.getCurrentRound();
      setRound(result.round);
      setCrashEnabled(result.enabled);
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
      .then((games) => setRtp(games.find((g) => g.id === 'crash')?.rtp ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ms = round?.status === 'running' ? POLL_INTERVAL_RUNNING_MS : POLL_INTERVAL_MS;
    const interval = setInterval(load, ms);
    return () => clearInterval(interval);
  }, [load, round?.status]);

  useEffect(() => {
    const interval = setInterval(() => setNow(getServerNow()), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Calage sur l'horloge serveur (voir lib/serverClock.ts) : une horloge client qui
  // dérive de quelques centaines de ms suffit à afficher un multiplicateur visuellement
  // faux par rapport à `started_at`/`crashed_at`, qui sont des instants serveur. Un
  // premier calage précis au montage (plusieurs essais, meilleur round-trip), puis un
  // recalage léger périodique pour suivre une éventuelle dérive/changement de réseau
  // tant que la page reste ouverte.
  useEffect(() => {
    syncServerClock().then(() => setNow(getServerNow()));
    const interval = setInterval(syncServerClock, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Cliquetis de jeton dès qu'un joueur (soi-même ou un autre) mise sur la manche.
  const prevBetCount = useRef<number | null>(null);
  const prevRoundId = useRef<number | null>(null);
  useEffect(() => {
    if (!round) return;
    if (prevRoundId.current !== round.id) {
      prevRoundId.current = round.id;
      prevBetCount.current = round.bets.length;
      return;
    }
    if (prevBetCount.current !== null && round.bets.length > prevBetCount.current) {
      sound.playChip();
    }
    prevBetCount.current = round.bets.length;
  }, [round]);

  // Détecte un retrait automatique déclenché côté serveur (donc jamais vu par
  // handleCashOut, qui affiche déjà son propre popup) : dès que la mise du joueur
  // passe de "en jeu" à "retirée" sans qu'un retrait manuel soit en cours.
  const prevMyCashedOut = useRef<boolean | null>(null);
  useEffect(() => {
    if (!round) return;
    const mine = round.bets.find((b) => b.user_id === user?.id);
    if (!mine) {
      prevMyCashedOut.current = null;
      return;
    }
    const isCashedOut = mine.cashout_multiplier_x100 !== null;
    if (prevMyCashedOut.current === false && isCashedOut && !manualCashoutRef.current) {
      sound.playCashRegister();
      const payout = Math.floor((mine.bet_amount * (mine.cashout_multiplier_x100 as number)) / 100);
      setCashoutPopup({ key: Date.now(), amount: payout - mine.bet_amount });
      setTimeout(() => setCashoutPopup(null), 1200);
    }
    prevMyCashedOut.current = isCashedOut;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  // Décollage au passage betting -> running, explosion + secousse au crash.
  const prevStatus = useRef<CrashRound['status'] | undefined>(undefined);
  useEffect(() => {
    if (!round) return;
    if (round.status === 'running' && prevStatus.current === 'betting') {
      sound.playLiftoff();
    }
    if (round.status === 'crashed' && prevStatus.current !== 'crashed') {
      // L'explosion sert déjà de signal "perdu" pour quiconque n'a pas retiré à
      // temps — un `playLose()` séparé par-dessus, au même instant, s'entendait
      // comme le son du crash joué deux fois.
      sound.playCrashExplosion();
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      const mine = round.bets.find((b) => b.user_id === user?.id);
      if (mine) {
        loadHistory();
      }
    }
    prevStatus.current = round.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.status]);

  // Particules de l'explosion, stables pour la durée d'affichage d'une manche crashée.
  const crashParticles = useMemo(() => {
    return Array.from({ length: 10 }, (_, i) => {
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const distance = 45 + Math.random() * 40;
      return {
        id: i,
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance,
        delay: Math.random() * 0.08,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  async function handleBet(e: FormEvent) {
    e.preventDefault();
    sound.unlockAudio();
    const amount = Number(betAmount);
    if (!Number.isInteger(amount) || amount <= 0) return;
    const autoRaw = autoCashout.trim();
    const autoValue = autoRaw ? Number(autoRaw) : null;
    if (autoValue !== null && (!Number.isFinite(autoValue) || autoValue <= 1)) {
      setError('Le multiplicateur de retrait automatique doit être supérieur à 1x');
      return;
    }
    setBetting(true);
    setError(null);
    try {
      const autoCashoutX100 = autoValue !== null ? Math.round(autoValue * 100) : null;
      const result = await crashApi.bet(amount, autoCashoutX100);
      setRound(result.round);
      setCrashEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      setBetAmount('');
      setAutoCashout('');
      gamblingApi.getStatus().then(setStatus).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBetting(false);
    }
  }

  async function handleSetAutoCashout(e: FormEvent) {
    e.preventDefault();
    const raw = autoCashoutEdit.trim();
    const value = raw ? Number(raw) : null;
    if (value !== null && (!Number.isFinite(value) || value <= 1)) {
      setError('Le multiplicateur de retrait automatique doit être supérieur à 1x');
      return;
    }
    setSavingAutoCashout(true);
    setError(null);
    try {
      const multiplierX100 = value !== null ? Math.round(value * 100) : null;
      const result = await crashApi.setAutoCashout(multiplierX100);
      setRound(result.round);
      setCrashEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      setAutoCashoutEdit('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingAutoCashout(false);
    }
  }

  async function handleClearAutoCashout() {
    setSavingAutoCashout(true);
    setError(null);
    try {
      const result = await crashApi.setAutoCashout(null);
      setRound(result.round);
      setCrashEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingAutoCashout(false);
    }
  }

  async function handleCashOut() {
    sound.unlockAudio();
    manualCashoutRef.current = true;
    setCashingOut(true);
    setError(null);
    try {
      const result = await crashApi.cashOut();
      setRound(result.round);
      setCrashEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      sound.playCashRegister();
      const mine = result.round.bets.find((b) => b.user_id === user?.id);
      if (mine?.cashout_multiplier_x100 != null) {
        const payout = Math.floor((mine.bet_amount * mine.cashout_multiplier_x100) / 100);
        setCashoutPopup({ key: Date.now(), amount: payout - mine.bet_amount });
        setTimeout(() => setCashoutPopup(null), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCashingOut(false);
      manualCashoutRef.current = false;
    }
  }

  const myBet = round?.bets.find((b) => b.user_id === user?.id);
  const canBet = round?.status === 'betting' && !myBet;
  const canCashOut = round?.status === 'running' && !!myBet && myBet.cashout_multiplier_x100 === null;
  const startsIn = round?.starts_at ? secondsUntil(round.starts_at, now) : null;
  const crashed = round?.status === 'crashed';
  const urgent = round?.status === 'betting' && startsIn !== null && startsIn <= 3;

  const elapsedSeconds = (() => {
    if (!round || !round.started_at) return 0;
    if (round.status === 'running') {
      return Math.max(0, (now - new Date(round.started_at).getTime()) / 1000);
    }
    if (round.status === 'crashed' && round.crashed_at) {
      return Math.max(0, (new Date(round.crashed_at).getTime() - new Date(round.started_at).getTime()) / 1000);
    }
    return 0;
  })();

  const liveMultiplier = round?.status === 'running' ? multiplierAt(elapsedSeconds) : 1;
  const displayMultiplier =
    crashed && round?.crash_point_x100 != null ? round.crash_point_x100 / 100 : liveMultiplier;
  const color = multiplierColor(displayMultiplier);
  const heartbeatSeconds = heartbeatDuration(liveMultiplier);

  // Battement de basse qui s'accélère avec le multiplicateur : calé sur le tick
  // déjà en cours (100ms) plutôt qu'un setTimeout récursif séparé, pour rester
  // synchronisé sans risque de closure périmée sur `liveMultiplier`.
  const lastBeatAt = useRef(0);
  useEffect(() => {
    if (!canCashOut) {
      lastBeatAt.current = 0;
      return;
    }
    if (lastBeatAt.current === 0) {
      // Démarre le minuteur sans jouer tout de suite : un battement pile au
      // moment du décollage se superposerait au son de décollage (playLiftoff),
      // perçu comme un 3e coup au lieu du lub-dub attendu.
      lastBeatAt.current = now;
      return;
    }
    if (now - lastBeatAt.current >= heartbeatSeconds * 1000) {
      sound.playHeartbeatBeat();
      lastBeatAt.current = now;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, canCashOut]);

  const estimatedCashout = myBet ? Math.floor(myBet.bet_amount * liveMultiplier) : 0;

  const canAfford = (user?.sp_balance ?? 0) >= (Number(betAmount) || 0);
  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);

  const points = curvePoints(elapsedSeconds, Math.max(displayMultiplier, 1.001));
  const path = pointsToPath(points);
  const rocketPoint = points[points.length - 1] as CurvePoint;
  const rocketPrevPoint = points[points.length - 2] ?? rocketPoint;
  const rocketAngle =
    Math.atan2(rocketPoint.y - rocketPrevPoint.y, rocketPoint.x - rocketPrevPoint.x) * (180 / Math.PI) + 45;
  const showRocket = round?.status === 'running' && elapsedSeconds > 0;
  const markerLeftPct = clampPercent((rocketPoint.x / GRAPH_WIDTH) * 100, 6);
  const markerTopPct = clampPercent((rocketPoint.y / GRAPH_HEIGHT) * 100, 8);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/gambling" className="text-sm text-emerald-400 font-medium">
          ← Jeux
        </Link>

        <div className="flex items-center justify-between mt-4 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-50">Crash</h1>
            {rtp !== null && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                {rtp}% redistribués
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {round && (
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  round.status === 'running'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : round.status === 'betting'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-red-500/15 text-red-400'
                }`}
              >
                {round.status === 'running' ? '🚀 En vol' : round.status === 'betting' ? '⏳ Mises ouvertes' : '💥 Crashé'}
              </span>
            )}
            <VolumeSlider />
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <SpectatorsList spectators={spectators} />

        {status && <GamblingBudgetBar status={{ ...status, enabled: crashEnabled }} />}

        {loading || !round ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            <div
              className="relative bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-4"
              style={shaking ? { animation: 'shake 0.4s ease-in-out' } : undefined}
            >
              <svg
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                preserveAspectRatio="none"
                className="w-full h-56 block"
              >
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    filter: `drop-shadow(0 0 6px ${multiplierGlow(displayMultiplier, 0.67)})`,
                    transition: 'stroke 0.3s ease',
                  }}
                />
              </svg>

              {showRocket && !crashed && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${markerLeftPct}%`,
                    top: `${markerTopPct}%`,
                    transform: `translate(-50%, -50%) rotate(${rocketAngle}deg)`,
                    fontSize: '22px',
                    filter: `drop-shadow(0 0 8px ${color})`,
                    transition: 'left 0.1s linear, top 0.1s linear',
                  }}
                >
                  🚀
                </div>
              )}

              {crashed && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${markerLeftPct}%`,
                    top: `${markerTopPct}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <span style={{ fontSize: '30px', display: 'inline-block', animation: 'popIn 0.3s ease-out' }}>
                    💥
                  </span>
                  {crashParticles.map((p) => (
                    <span
                      key={p.id}
                      className="absolute left-1/2 top-1/2 text-sm"
                      style={
                        {
                          '--tx': `${p.tx}px`,
                          '--ty': `${p.ty}px`,
                          animation: `particleBurst 0.6s ease-out ${p.delay}s forwards`,
                        } as CSSProperties
                      }
                    >
                      ✨
                    </span>
                  ))}
                </div>
              )}

              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p
                  className="text-5xl font-black tabular-nums"
                  style={{
                    color,
                    transition: 'color 0.3s ease',
                    // Contour sombre + ombre portée : le texte partage la couleur de la
                    // ligne (dégradé rouge -> vert), sans ça il s'y fond complètement
                    // quand la courbe passe derrière lui.
                    WebkitTextStroke: '2px rgba(9, 9, 11, 0.85)',
                    paintOrder: 'stroke fill',
                    textShadow: '0 2px 10px rgba(0, 0, 0, 0.6)',
                    animation: crashed
                      ? 'popIn 0.25s ease-out'
                      : round.status === 'running'
                        ? `heartbeat ${heartbeatSeconds}s ease-in-out infinite`
                        : undefined,
                  }}
                >
                  {displayMultiplier.toFixed(2)}x
                </p>
                {round.status === 'betting' && (
                  <p
                    className={`text-sm font-medium mt-1 ${urgent ? 'text-red-400' : 'text-amber-400'}`}
                    style={urgent ? { animation: 'popIn 0.3s ease-out' } : undefined}
                  >
                    {round.starts_at ? `Décollage dans ${startsIn}s…` : 'En attente de joueurs…'}
                  </p>
                )}
                {crashed && (
                  <p className="text-sm text-red-400 font-medium mt-1" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                    Crashé !
                  </p>
                )}
                {cashoutPopup && (
                  <p
                    key={cashoutPopup.key}
                    className="absolute text-2xl font-black text-emerald-400"
                    style={{ animation: 'floatUp 1.2s ease-out forwards', bottom: '55%' }}
                  >
                    +{cashoutPopup.amount} SP
                  </p>
                )}
              </div>
            </div>

            {canBet && (
              <form
                onSubmit={handleBet}
                className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-4"
              >
                <p className="text-sm font-medium text-zinc-200 mb-2">Miser sur cette manche</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    required
                    placeholder="Mise (SP)"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={betting || !betAmount || !canAfford || !crashEnabled}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                  >
                    {betting ? 'Mise…' : 'Miser'}
                  </button>
                </div>
                {betAmount && !canAfford && (
                  <p className="text-xs text-red-400 mt-2">Solde SP insuffisant.</p>
                )}
                <input
                  type="number"
                  min="1.01"
                  step="0.01"
                  placeholder="Retrait auto (optionnel, ex: 2.00)"
                  value={autoCashout}
                  onChange={(e) => setAutoCashout(e.target.value)}
                  className="w-full mt-2 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Il te reste {budgetLeft} SP de budget gambling aujourd'hui.
                </p>
              </form>
            )}

            {myBet && round.status === 'betting' && (
              <p className="text-center text-sm text-zinc-400 mb-4">
                Tu as misé {myBet.bet_amount} SP — la manche démarre bientôt.
              </p>
            )}

            {myBet && myBet.cashout_multiplier_x100 === null && !crashed && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-4">
                <p className="text-sm font-medium text-zinc-200 mb-2">Retrait automatique</p>
                {myBet.auto_cashout_multiplier_x100 !== null ? (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-emerald-400 font-semibold">
                      Réglé à {formatX100(myBet.auto_cashout_multiplier_x100)}x
                    </span>
                    <button
                      type="button"
                      onClick={handleClearAutoCashout}
                      disabled={savingAutoCashout}
                      className="text-xs text-red-400 hover:underline disabled:opacity-40"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSetAutoCashout} className="flex gap-2">
                    <input
                      type="number"
                      min="1.01"
                      step="0.01"
                      placeholder="ex: 2.00"
                      value={autoCashoutEdit}
                      onChange={(e) => setAutoCashoutEdit(e.target.value)}
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={savingAutoCashout || !autoCashoutEdit}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-medium px-3 py-2 rounded-md transition disabled:opacity-40"
                    >
                      {savingAutoCashout ? '…' : 'Régler'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {canCashOut && (
              <button
                onClick={handleCashOut}
                disabled={cashingOut}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-3 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 mb-4"
                style={{ animation: 'softPulse 1s ease-in-out infinite' }}
              >
                {cashingOut ? 'Retrait…' : `Retirer (~${estimatedCashout} SP)`}
              </button>
            )}

            {myBet && myBet.cashout_multiplier_x100 !== null && round.status !== 'betting' && (
              <p className="text-center text-sm text-emerald-400 font-medium mb-4">
                Retiré à {formatX100(myBet.cashout_multiplier_x100)}x — +
                {Math.floor((myBet.bet_amount * myBet.cashout_multiplier_x100) / 100) - myBet.bet_amount} SP
              </p>
            )}

            {round.bets.length === 0 && (
              <p className="text-sm text-zinc-500 text-center mb-4">
                Personne n'a encore misé sur cette manche.
              </p>
            )}

            {round.bets.length > 0 && (
              <ul className="divide-y divide-zinc-800 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-4">
                {round.bets.map((b) => {
                  const net = netResult(b, crashed ?? false);
                  const cashedOut = b.cashout_multiplier_x100 !== null;
                  const stillPlaying = !cashedOut && !crashed;
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 px-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar
                          username={b.username}
                          avatarUrl={b.avatar_url}
                          size={24}
                          frameUrl={b.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                        />
                        <div className="min-w-0">
                          <UserNameTag
                            username={b.user_id === user?.id ? 'Toi' : b.username}
                            equipped={b.equipped_cosmetics}
                            className="text-zinc-300 truncate min-w-0"
                          />
                          <p className="text-xs text-zinc-500">Mise {b.bet_amount} SP</p>
                        </div>
                      </div>
                      <span
                        className={`font-semibold flex-shrink-0 text-xs inline-flex items-center gap-1 ${
                          cashedOut ? 'text-emerald-400' : crashed ? 'text-red-400' : 'text-zinc-500'
                        }`}
                      >
                        {stillPlaying && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                        {cashedOut
                          ? `Retiré à ${formatX100(b.cashout_multiplier_x100 as number)}x (+${net} SP)`
                          : crashed
                            ? `Crashé (${net} SP)`
                            : 'En jeu…'}
                      </span>
                    </li>
                  );
                })}
              </ul>
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
                const net = netResult(h, h.cashout_multiplier_x100 === null);
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
                          {h.cashout_multiplier_x100 !== null && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                              Retiré à {formatX100(h.cashout_multiplier_x100)}x
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">
                          Mise {h.bet_amount} SP · Crash à {formatX100(h.crash_point_x100)}x
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-semibold flex-shrink-0 ${
                        net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-zinc-500'
                      }`}
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
