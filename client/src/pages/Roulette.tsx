import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  RouletteRound,
} from '../types.js';

/**
 * Rouge/noir dérive uniquement de la position physique du numéro sur une
 * roue européenne standard — ce n'est pas une règle de gain configurable par
 * le MSP (contrairement aux multiplicateurs, chargés depuis l'API), donc pas
 * de raison de la faire porter par le serveur.
 */
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

type PlacedBet = RouletteBet & { key: string };
function betKey(type: RouletteBetType, number?: number | null): string {
  return `${type}:${number ?? ''}`;
}

const OUTSIDE_BETS: { type: RouletteBetType; short: string }[] = [
  { type: 'red', short: 'Rouge' },
  { type: 'black', short: 'Noir' },
  { type: 'odd', short: 'Impair' },
  { type: 'even', short: 'Pair' },
  { type: 'low', short: '1-18' },
  { type: 'high', short: '19-36' },
  { type: 'dozen1', short: '1ère douz.' },
  { type: 'dozen2', short: '2ème douz.' },
  { type: 'dozen3', short: '3ème douz.' },
  { type: 'col1', short: 'Colonne 1' },
  { type: 'col2', short: 'Colonne 2' },
  { type: 'col3', short: 'Colonne 3' },
];

const REEL_ITEM_WIDTH = 56;
const REEL_FILLER_COUNT = 28;
const REEL_SPIN_MS = 3200;

/** Bande de numéros qui défile puis s'arrête sur `winningNumber` (déjà connu
 * côté serveur avant même le début de l'animation — celle-ci est purement
 * cosmétique) — même idiom que GamblingReel.tsx (transform CSS + repos avant
 * lancement) mais simplifié : une simple transition CSS suffit, pas besoin
 * de piloter l'easing frame par frame. */
function NumberReel({
  spinToken,
  winningNumber,
  onLanded,
}: {
  spinToken: number;
  winningNumber: number | null;
  onLanded: () => void;
}) {
  const [items, setItems] = useState<number[]>([]);
  const [offset, setOffset] = useState(0);
  const [transitionOn, setTransitionOn] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spinToken === 0 || winningNumber === null) return;
    const filler = Array.from({ length: REEL_FILLER_COUNT }, () => Math.floor(Math.random() * 37));
    const reel = [...filler, winningNumber];
    setItems(reel);
    setTransitionOn(false);
    setOffset(0);

    // Aligne le CENTRE du dernier item (le gagnant) sur le marqueur central —
    // le track démarre au centre du conteneur (`left-1/2`), donc l'item
    // d'index i a son centre à `i*ITEM_WIDTH + ITEM_WIDTH/2` de ce point.
    const targetOffset = (reel.length - 1) * REEL_ITEM_WIDTH + REEL_ITEM_WIDTH / 2;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setTransitionOn(true);
        setOffset(targetOffset);
      });
    });

    const timeout = setTimeout(() => {
      sound.playTick();
      onLanded();
    }, REEL_SPIN_MS);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinToken]);

  if (items.length === 0) return null;

  return (
    <div className="relative w-full h-16 overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800 mb-4">
      <div
        ref={trackRef}
        className="absolute inset-y-0 left-1/2 flex items-center"
        style={{
          transform: `translateX(${-offset}px)`,
          transition: transitionOn ? `transform ${REEL_SPIN_MS}ms cubic-bezier(0.1, 0.7, 0.2, 1)` : 'none',
        }}
      >
        {items.map((n, i) => (
          <div
            key={i}
            className={`flex-shrink-0 flex items-center justify-center font-bold text-lg rounded ${tileClass(n)}`}
            style={{ width: REEL_ITEM_WIDTH - 4, height: 40, margin: '0 2px' }}
          >
            {n}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-amber-400/90" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-zinc-950 via-transparent to-zinc-950" />
    </div>
  );
}

function formatMultiplier(x100: number): string {
  return `x${(x100 / 100).toFixed(x100 % 100 === 0 ? 0 : 2)}`;
}

export default function Roulette() {
  const { user, setUser } = useAuth();
  const spectators = useSpectators('roulette');
  useAnnounceChatRoom({ room: 'roulette', roomKey: '', label: 'Roulette', icon: '🎡' });

  const [rouletteEnabled, setRouletteEnabled] = useState(true);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [rtp, setRtp] = useState<number | null>(null);
  const [payouts, setPayouts] = useState<RoulettePayoutInfo[]>([]);
  const [history, setHistory] = useState<RouletteHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('all');

  const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
  const [chipAmount, setChipAmount] = useState('1');
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRound, setLastRound] = useState<RouletteRound | null>(null);
  const [pendingBalance, setPendingBalance] = useState<number | null>(null);
  const [spinToken, setSpinToken] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [resultPopup, setResultPopup] = useState<{ key: number; amount: number } | null>(null);

  const payoutByType = useMemo(() => new Map(payouts.map((p) => [p.type, p] as const)), [payouts]);

  const loadHistory = useCallback(() => {
    rouletteApi
      .getHistory(10, historyScope === 'mine')
      .then(setHistory)
      .catch(() => {});
  }, [historyScope]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    gamblingApi.getStatus().then(setStatus).catch(() => {});
    gamblingApi
      .listGames()
      .then((games) => {
        const g = games.find((x) => x.id === 'roulette');
        setRtp(g?.rtp ?? null);
        setRouletteEnabled(g?.enabled ?? false);
      })
      .catch(() => {});
    rouletteApi.getPayouts().then(setPayouts).catch(() => {});
  }, []);

  const totalWager = placedBets.reduce((sum, b) => sum + b.amount, 0);
  const canAfford = (user?.sp_balance ?? 0) >= totalWager;
  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);

  function placeBet(type: RouletteBetType, number?: number) {
    if (spinning) return;
    sound.unlockAudio();
    const amount = Math.floor(Number(chipAmount));
    if (!Number.isInteger(amount) || amount <= 0) return;
    const key = betKey(type, number ?? null);
    setPlacedBets((prev) => {
      const existing = prev.find((b) => b.key === key);
      if (existing) {
        return prev.map((b) => (b.key === key ? { ...b, amount: b.amount + amount } : b));
      }
      return [...prev, { key, type, number: number ?? null, amount }];
    });
    setError(null);
  }

  function undoLastBet() {
    if (spinning) return;
    sound.unlockAudio();
    setPlacedBets((prev) => prev.slice(0, -1));
  }

  function clearBets() {
    if (spinning) return;
    setPlacedBets([]);
  }

  async function handleSpin() {
    if (spinning || placedBets.length === 0 || !canAfford || !rouletteEnabled) return;
    sound.unlockAudio();
    setSpinning(true);
    setError(null);
    setRevealed(false);
    setLastRound(null);
    try {
      const bets: RouletteBet[] = placedBets.map((b) => ({ type: b.type, number: b.number, amount: b.amount }));
      const result = await rouletteApi.spin(bets);
      setLastRound(result.round);
      setRouletteEnabled(result.enabled);
      // Le solde n'est appliqué qu'à la fin de l'animation (onReelLanded), pour
      // ne pas révéler le résultat (via le solde affiché) avant que la roue ne
      // s'arrête visuellement — même si la manche est déjà réglée côté serveur.
      setPendingBalance(result.balance);
      setSpinToken((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSpinning(false);
    }
  }

  function onReelLanded() {
    if (!lastRound || !user || pendingBalance === null) {
      setSpinning(false);
      return;
    }
    setRevealed(true);
    setUser({ ...user, sp_balance: pendingBalance });
    const net = lastRound.total_payout - lastRound.total_wager;
    if (net > 0) sound.playWin();
    else sound.playLose();
    setResultPopup({ key: Date.now(), amount: net });
    setTimeout(() => setResultPopup(null), 1200);
    setPlacedBets([]);
    setPendingBalance(null);
    setSpinning(false);
    loadHistory();
    gamblingApi.getStatus().then(setStatus).catch(() => {});
  }

  const betAmountFor = (type: RouletteBetType, number?: number) =>
    placedBets.find((b) => b.key === betKey(type, number ?? null))?.amount ?? 0;

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
        {!rouletteEnabled && (
          <p className="mb-4 text-sm text-red-400">La Roulette est désactivée par le MSP.</p>
        )}

        <SpectatorsList spectators={spectators} />

        {status && <GamblingBudgetBar status={{ ...status, enabled: rouletteEnabled }} />}

        <div className="rounded-xl shadow-md p-4 mb-4 border-2 border-emerald-500/20 bg-zinc-900/80">
          <NumberReel spinToken={spinToken} winningNumber={lastRound?.winning_number ?? null} onLanded={onReelLanded} />

          {revealed && lastRound && (
            <div className="relative text-center mb-4">
              <p className="text-sm text-zinc-400">
                Numéro gagnant :{' '}
                <span className={`font-bold px-2 py-0.5 rounded ${tileClass(lastRound.winning_number)}`}>
                  {lastRound.winning_number}
                </span>
              </p>
              <p className={`text-sm font-medium mt-1 ${lastRound.total_payout > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {lastRound.total_payout > 0
                  ? `Gagné ${lastRound.total_payout} SP`
                  : `Perdu ${lastRound.total_wager} SP`}
              </p>
              {resultPopup && (
                <p
                  key={resultPopup.key}
                  className={`absolute left-1/2 -translate-x-1/2 -top-2 text-2xl font-black ${resultPopup.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  style={{ animation: 'floatUp 1.2s ease-out forwards' }}
                >
                  {resultPopup.amount > 0 ? `+${resultPopup.amount}` : resultPopup.amount} SP
                </p>
              )}
            </div>
          )}

          {/* Numéros pleins */}
          <div className="mb-3">
            <button
              type="button"
              disabled={spinning}
              onClick={() => placeBet('straight', 0)}
              className={`relative w-full h-10 rounded-md font-bold mb-1.5 transition active:scale-95 disabled:opacity-40 ${tileClass(0)}`}
            >
              0
              {betAmountFor('straight', 0) > 0 && (
                <span className="absolute top-0.5 right-1 text-[10px] bg-black/40 rounded px-1">
                  {betAmountFor('straight', 0)}
                </span>
              )}
            </button>
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={spinning}
                  onClick={() => placeBet('straight', n)}
                  className={`relative h-10 rounded-md font-bold text-sm transition active:scale-95 disabled:opacity-40 hover:ring-1 hover:ring-amber-400/60 ${tileClass(n)}`}
                >
                  {n}
                  {betAmountFor('straight', n) > 0 && (
                    <span className="absolute top-0 right-0.5 text-[9px] bg-black/40 rounded px-1">
                      {betAmountFor('straight', n)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Chances extérieures */}
          <div className="grid grid-cols-3 gap-1.5 mb-4">
            {OUTSIDE_BETS.map(({ type, short }) => {
              const info = payoutByType.get(type);
              const amt = betAmountFor(type);
              return (
                <button
                  key={type}
                  type="button"
                  disabled={spinning}
                  onClick={() => placeBet(type)}
                  className={`relative h-12 rounded-md text-xs font-semibold border transition active:scale-95 disabled:opacity-40 ${
                    amt > 0
                      ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                      : 'border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:border-zinc-600'
                  }`}
                >
                  <span className="block">{short}</span>
                  {info && <span className="block text-[10px] text-zinc-500">{formatMultiplier(info.multiplier_x100)}</span>}
                  {amt > 0 && (
                    <span className="absolute top-0.5 right-1 text-[10px] bg-black/40 rounded px-1">{amt}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="number"
              min={1}
              value={chipAmount}
              onChange={(e) => setChipAmount(e.target.value)}
              disabled={spinning}
              placeholder="Montant par mise"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            />
            <button
              type="button"
              onClick={undoLastBet}
              disabled={spinning || placedBets.length === 0}
              className="px-3 py-2 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-600 disabled:opacity-40 text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={clearBets}
              disabled={spinning || placedBets.length === 0}
              className="px-3 py-2 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-600 disabled:opacity-40 text-sm"
            >
              Tout effacer
            </button>
          </div>

          <p className="text-sm text-zinc-400 mb-2">
            Total misé : <span className="font-semibold text-zinc-200">{totalWager} SP</span>
          </p>
          {totalWager > 0 && !canAfford && (
            <p className="text-xs text-red-400 mb-2">Solde SP insuffisant.</p>
          )}

          <button
            type="button"
            onClick={handleSpin}
            disabled={spinning || placedBets.length === 0 || !canAfford || !rouletteEnabled}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-3 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:active:scale-100"
          >
            {spinning ? 'La roue tourne…' : 'Lancer la roue'}
          </button>
          <p className="text-xs text-zinc-500 mt-2 text-center">
            Il te reste {budgetLeft} SP de budget gambling aujourd'hui.
          </p>
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase">Historique des manches</h2>
            <HistoryScopeToggle scope={historyScope} onChange={setHistoryScope} />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune manche pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const net = h.total_payout - h.total_wager;
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
                          <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${tileClass(h.winning_number)}`}>
                            {h.winning_number}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500">
                          Mise {h.total_wager} SP · {h.bets.length} pari{h.bets.length > 1 ? 's' : ''}
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
