import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as slotsApi from '../api/slots.js';
import * as gamblingApi from '../api/gambling.js';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import HistoryScopeToggle, { type HistoryScope } from '../components/HistoryScopeToggle.jsx';
import * as sound from '../lib/sound.js';
import type { GamblingStatus, SlotHistoryEntry, SlotSymbolInfo, SlotSymbolKey } from '../types.js';

/** Ordre d'affichage, du plus commun au plus rare — sert la paytable et le tirage visuel pendant le spin. */
const ALL_SYMBOLS: SlotSymbolKey[] = ['straw', 'wood', 'brick', 'pig', 'wolf', 'house', 'wild', 'gem'];

const SYMBOL_META: Record<SlotSymbolKey, { label: string; rarity: string; ring: string; glow: string }> = {
  straw: { label: 'Paille', rarity: 'Commun', ring: '#fde68a', glow: 'rgba(253,230,138,0.55)' },
  wood: { label: 'Bois', rarity: 'Commun', ring: '#d9a066', glow: 'rgba(217,160,102,0.55)' },
  brick: { label: 'Briques', rarity: 'Peu commun', ring: '#fb923c', glow: 'rgba(251,146,60,0.55)' },
  pig: { label: 'Cochon', rarity: 'Peu commun', ring: '#f9a8d4', glow: 'rgba(249,168,212,0.6)' },
  wolf: { label: 'Loup', rarity: 'Rare', ring: '#94a3b8', glow: 'rgba(148,163,184,0.6)' },
  house: { label: 'Maison', rarity: 'Rare', ring: '#38bdf8', glow: 'rgba(56,189,248,0.6)' },
  wild: { label: 'Couronne (wild)', rarity: 'Très rare', ring: '#c084fc', glow: 'rgba(192,132,252,0.7)' },
  gem: { label: 'Gemme (jackpot)', rarity: 'Jackpot', ring: '#67e8f9', glow: 'rgba(103,232,249,0.8)' },
};

/** Instants (ms depuis le lancement du spin) auxquels chaque rouleau s'arrête, en cascade classique gauche → droite. */
const REEL_STOP_MS = [650, 950, 1300];

function formatX100(x100: number): string {
  return (x100 / 100).toFixed(2);
}

function randomSymbol(): SlotSymbolKey {
  return ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)] as SlotSymbolKey;
}

function symbolIcon(key: SlotSymbolKey): string {
  return `/gambling/slots/${key}.svg`;
}

export default function Slots() {
  const { user, setUser } = useAuth();
  const [slotsEnabled, setSlotsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [rtp, setRtp] = useState<number | null>(null);
  const [paytable, setPaytable] = useState<SlotSymbolInfo[]>([]);
  const [showPaytable, setShowPaytable] = useState(false);
  const [history, setHistory] = useState<SlotHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('all');

  const [betAmount, setBetAmount] = useState('');
  const [reels, setReels] = useState<SlotSymbolKey[]>(['straw', 'pig', 'wolf']);
  const [reelSpinning, setReelSpinning] = useState([false, false, false]);
  const [leverPulled, setLeverPulled] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [resultPopup, setResultPopup] = useState<{ key: number; amount: number } | null>(null);
  const [burstId, setBurstId] = useState(0);

  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const loadHistory = useCallback(() => {
    slotsApi
      .getHistory(10, historyScope === 'mine')
      .then(setHistory)
      .catch(() => {});
  }, [historyScope]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const load = useCallback(async () => {
    try {
      const result = await slotsApi.getStatus();
      setSlotsEnabled(result.enabled);
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
      .then((games) => setRtp(games.find((g) => g.id === 'slots')?.rtp ?? null))
      .catch(() => {});
    slotsApi.getPaytable().then(setPaytable).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const canAfford = (user?.sp_balance ?? 0) >= (Number(betAmount) || 0);
  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);

  const paytableByKey = useMemo(() => new Map(paytable.map((p) => [p.key, p] as const)), [paytable]);

  // Ref miroir de reelSpinning, lue par l'intervalle de brassage visuel (évite
  // de recréer l'intervalle à chaque changement d'état pendant le spin).
  const reelSpinningRef = useRef(reelSpinning);
  reelSpinningRef.current = reelSpinning;

  async function handleSpin(e: FormEvent) {
    e.preventDefault();
    sound.unlockAudio();
    const amount = Number(betAmount);
    if (!Number.isInteger(amount) || amount <= 0 || spinning) return;

    setSpinning(true);
    setError(null);
    setLastPayout(null);
    setReelSpinning([true, true, true]);
    setLeverPulled(true);
    setTimeout(() => setLeverPulled(false), 320);

    spinIntervalRef.current = setInterval(() => {
      setReels((prev) => prev.map((s, i) => (reelSpinningRef.current[i] ? randomSymbol() : s)));
    }, 80);

    try {
      const result = await slotsApi.spin(amount);

      timeoutsRef.current = REEL_STOP_MS.map((delay, i) =>
        setTimeout(() => {
          sound.playChip();
          setReels((prev) => {
            const next = [...prev];
            next[i] = result.reels[i] as SlotSymbolKey;
            return next;
          });
          setReelSpinning((prev) => {
            const next = [...prev] as [boolean, boolean, boolean];
            next[i] = false;
            return next;
          });
          if (i === REEL_STOP_MS.length - 1) {
            if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
            if (user) setUser({ ...user, sp_balance: result.balance });
            setLastPayout(result.payout);
            if (result.payout > 0) {
              sound.playWin();
              setBurstId((n) => n + 1);
              const net = result.payout - amount;
              setResultPopup({ key: Date.now(), amount: net });
              setTimeout(() => setResultPopup(null), 1200);
            } else {
              sound.playLose();
            }
            gamblingApi.getStatus().then(setStatus).catch(() => {});
            loadHistory();
            setSpinning(false);
          }
        }, delay)
      );
    } catch (err) {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
      setReelSpinning([false, false, false]);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSpinning(false);
    }
  }

  const burstParticles = useMemo(() => {
    if (!burstId) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const distance = 50 + Math.random() * 45;
      return {
        id: i,
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance,
        delay: Math.random() * 0.1,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstId]);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/gambling" className="text-sm text-emerald-400 font-medium">
          ← Jeux
        </Link>

        <div className="flex items-center justify-between mt-4 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-50">Machine à sous</h1>
            {rtp !== null && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                {rtp}% redistribués
              </span>
            )}
          </div>
          <VolumeSlider />
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {status && <GamblingBudgetBar status={{ ...status, enabled: slotsEnabled }} />}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            {/* Cabinet doré */}
            <div
              className="relative rounded-[28px] p-1 mb-4 shadow-xl"
              style={{
                background:
                  'linear-gradient(155deg, #f9e39a 0%, #d4a94a 22%, #8a5a1e 55%, #d4a94a 78%, #f9e39a 100%)',
              }}
            >
              <div className="flex justify-center gap-2 py-2.5">
                {Array.from({ length: 9 }, (_, i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: '#fef3c7',
                      boxShadow: '0 0 7px 2px rgba(253,224,71,0.85)',
                      animation: `softPulse 1.5s ease-in-out ${i * 0.14}s infinite`,
                    }}
                  />
                ))}
              </div>

              <p className="text-center text-sm font-black tracking-wide text-[#4a2f0d] mb-2">
                🐷 TROIS PETITS COCHONS 🐺
              </p>

              <div className="rounded-2xl bg-zinc-950 border-4 border-[#8a5a1e] p-4 mx-1 mb-1 relative overflow-hidden">
                <div className="grid grid-cols-3 gap-2.5">
                  {reels.map((symbol, i) => {
                    const meta = SYMBOL_META[symbol];
                    return (
                      <div
                        key={i}
                        className="relative rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-950 border border-zinc-800 h-28 flex items-center justify-center"
                      >
                        <div
                          className={`w-[4.5rem] h-[4.5rem] rounded-full flex items-center justify-center transition-[filter] duration-100 ${
                            reelSpinning[i] ? 'blur-[2px]' : ''
                          }`}
                          style={{
                            background: 'radial-gradient(circle at 35% 28%, #fff8dc, #f2c94c 45%, #a5720f 85%)',
                            boxShadow: `0 0 0 3px rgba(255,255,255,0.18), 0 0 20px -2px ${meta.glow}, inset 0 2px 5px rgba(255,255,255,0.65), inset 0 -7px 11px rgba(0,0,0,0.35)`,
                          }}
                        >
                          <img src={symbolIcon(symbol)} alt={meta.label} className="w-11 h-11" draggable={false} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {burstId > 0 && !!lastPayout && !spinning && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {burstParticles.map((p) => (
                      <span
                        key={`${burstId}-${p.id}`}
                        className="absolute left-1/2 top-1/2 text-base"
                        style={
                          {
                            '--tx': `${p.tx}px`,
                            '--ty': `${p.ty}px`,
                            animation: `particleBurst 0.7s ease-out ${p.delay}s forwards`,
                          } as CSSProperties
                        }
                      >
                        🪙
                      </span>
                    ))}
                  </div>
                )}

                <div className="relative text-center mt-3 h-7">
                  {!spinning && lastPayout !== null && lastPayout > 0 && (
                    <p className="text-emerald-400 font-black text-lg" style={{ animation: 'popIn 0.3s ease-out' }}>
                      +{lastPayout} SP !
                    </p>
                  )}
                  {!spinning && lastPayout === 0 && (
                    <p className="text-zinc-600 text-sm font-medium">Pas de chance, retente ta chance</p>
                  )}
                  {resultPopup && (
                    <p
                      key={resultPopup.key}
                      className="absolute left-1/2 -translate-x-1/2 bottom-full text-2xl font-black text-emerald-400"
                      style={{ animation: 'floatUp 1.2s ease-out forwards' }}
                    >
                      +{resultPopup.amount} SP
                    </p>
                  )}
                </div>
              </div>

              {/* Commandes : mise + bouton spin + levier décoratif */}
              <form onSubmit={handleSpin} className="flex items-stretch gap-2 px-1 pb-1 pt-1">
                <input
                  type="number"
                  min={1}
                  required
                  placeholder="Mise (SP)"
                  value={betAmount}
                  disabled={spinning}
                  onChange={(e) => setBetAmount(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/60 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={spinning || !betAmount || !canAfford || !slotsEnabled}
                  className="font-black px-5 py-2 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 text-zinc-950 bg-amber-400 hover:bg-amber-300"
                >
                  {spinning ? 'Ça tourne…' : 'SPIN'}
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSpin(e as unknown as FormEvent)}
                  disabled={spinning || !betAmount || !canAfford || !slotsEnabled}
                  aria-label="Levier"
                  className="w-9 flex-shrink-0 rounded-md bg-gradient-to-b from-zinc-700 to-zinc-900 border border-zinc-600 flex items-start justify-center pt-1 disabled:opacity-40"
                >
                  <span
                    className="w-2.5 h-8 rounded-full bg-gradient-to-b from-zinc-400 to-zinc-600 origin-top transition-transform duration-150"
                    style={{ transform: leverPulled ? 'rotate(28deg)' : 'rotate(0deg)' }}
                  >
                    <span className="block w-4 h-4 rounded-full bg-red-500 -ml-[3px] shadow" />
                  </span>
                </button>
              </form>
              {betAmount && !canAfford && (
                <p className="text-xs text-red-100 px-1 pb-2">Solde SP insuffisant.</p>
              )}
              <p className="text-xs text-[#4a2f0d]/80 px-1 pb-2 font-medium">
                Il te reste {budgetLeft} SP de budget gambling aujourd'hui.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowPaytable(true)}
              className="w-full border border-zinc-700 hover:border-zinc-600 text-zinc-300 font-semibold px-4 py-2.5 rounded-md transition mb-4"
            >
              Table des gains
            </button>
          </>
        )}

        {showPaytable && (
          <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
            onClick={() => setShowPaytable(false)}
          >
            <div
              className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl max-w-sm w-full p-5 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-zinc-100">Table des gains</h2>
                <button onClick={() => setShowPaytable(false)} className="text-zinc-500 hover:text-zinc-300">
                  ✕
                </button>
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                Un symbole "couronne" (wild) remplace n'importe quel autre symbole pour compléter un triple.
              </p>
              <ul className="space-y-2">
                {ALL_SYMBOLS.map((key) => {
                  const meta = SYMBOL_META[key];
                  const info = paytableByKey.get(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-3 bg-zinc-950/60 border border-zinc-800 rounded-lg p-2.5"
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: 'radial-gradient(circle at 35% 28%, #fff8dc, #f2c94c 45%, #a5720f 85%)',
                          boxShadow: `0 0 0 2px rgba(255,255,255,0.18), 0 0 10px -2px ${meta.glow}`,
                        }}
                      >
                        <img src={symbolIcon(key)} alt={meta.label} className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                          {meta.label}
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium uppercase tracking-wide">
                            {meta.rarity}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500">
                          Triple : x{info ? formatX100(info.mult3_x100) : '…'}
                          {info?.mult2_x100 !== null && info?.mult2_x100 !== undefined
                            ? ` · Doublé : x${formatX100(info.mult2_x100)}`
                            : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase">Historique des spins</h2>
            <HistoryScopeToggle scope={historyScope} onChange={setHistoryScope} />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun spin pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const net = h.payout - h.bet_amount;
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
                          <span className="flex items-center gap-0.5 ml-1">
                            {h.reels.map((s, i) => (
                              <img key={i} src={symbolIcon(s)} alt={s} className="w-4 h-4" />
                            ))}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500">Mise {h.bet_amount} SP</p>
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

        <p className="text-center text-[11px] text-zinc-700 mt-6">
          Symboles :{' '}
          <a
            href="https://github.com/jdecked/twemoji"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-500"
          >
            Twemoji
          </a>{' '}
          (CC-BY 4.0)
        </p>
      </div>
    </div>
  );
}
