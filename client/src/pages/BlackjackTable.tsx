import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as blackjackApi from '../api/blackjack.js';
import * as gamblingApi from '../api/gambling.js';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import PlayingCard from '../components/PlayingCard.jsx';
import BlackjackSeat from '../components/BlackjackSeat.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import * as sound from '../lib/sound.js';
import type {
  BlackjackCard,
  BlackjackHand,
  BlackjackHistoryEntry,
  BlackjackSession,
  GamblingStatus,
} from '../types.js';

const POLL_INTERVAL_MS = 1000;
const TICK_INTERVAL_MS = 1000;
const MAX_SEATS = 8;
/** Rayon du cercle de sièges, en % de la moitié du conteneur. */
const SEAT_RADIUS_PCT = 38;
/** Distance (px) parcourue par une carte tout juste distribuée, dans la direction du centre vers le siège. */
const DEAL_MAGNITUDE_PX = 70;

function handValue(cards: BlackjackCard[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      total += 11;
      aces += 1;
    } else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') {
      total += 10;
    } else {
      total += Number(c.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function secondsUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

/** Fait tourner la liste des mains pour que celle du joueur local soit en tête — elle
 * sera donc toujours placée en bas du cercle, quel que soit son ordre réel d'arrivée. */
function rotateToMeFirst(hands: BlackjackHand[], myUserId: number | undefined): BlackjackHand[] {
  if (!myUserId) return hands;
  const idx = hands.findIndex((h) => h.user_id === myUserId);
  if (idx <= 0) return hands;
  return [...hands.slice(idx), ...hands.slice(0, idx)];
}

/** Position (%) sur le cercle et vecteur d'origine (px) pour l'animation de distribution,
 * pour le siège d'index i parmi n. i=0 → bas du cercle. */
function seatLayout(i: number, n: number) {
  const angle = Math.PI / 2 + (i / n) * 2 * Math.PI;
  const x = 50 + SEAT_RADIUS_PCT * Math.cos(angle);
  const y = 50 + SEAT_RADIUS_PCT * Math.sin(angle);
  const dealOrigin = {
    dx: -Math.cos(angle) * DEAL_MAGNITUDE_PX,
    dy: -Math.sin(angle) * DEAL_MAGNITUDE_PX,
  };
  return { x, y, dealOrigin };
}

function DealerCards({ cards }: { cards: (BlackjackCard | null)[] }) {
  const prevCount = useRef(0);
  const newFrom = prevCount.current;

  useEffect(() => {
    const from = prevCount.current;
    if (cards.length > from) {
      for (let i = from; i < cards.length; i++) {
        sound.playCardDeal((i * 150) / 1000);
      }
    }
    prevCount.current = cards.length;
  }, [cards.length]);

  if (cards.length === 0) {
    return <p className="text-xs text-zinc-500">En attente…</p>;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-1 max-w-[10rem]">
      {cards.map((c, i) => {
        const isNew = i >= newFrom;
        const style: CSSProperties | undefined = isNew
          ? ({
              '--deal-dx': '0px',
              '--deal-dy': '-50px',
              animation: 'dealCard 0.35s ease-out backwards',
              animationDelay: `${i * 150}ms`,
            } as CSSProperties)
          : undefined;
        return <PlayingCard key={i} card={c} style={style} />;
      })}
    </div>
  );
}

/** Net SP gagné/perdu sur une main résolue — dérivé de la même logique de paiement
 * que `resolveRound` côté serveur (bet.service.ts), juste pour l'affichage. */
function netResult(hand: { bet_amount: number; outcome: BlackjackHand['outcome'] }): number {
  switch (hand.outcome) {
    case 'win':
      return hand.bet_amount;
    case 'blackjack':
      return Math.floor(hand.bet_amount * 1.5);
    case 'push':
      return 0;
    case 'lose':
    default:
      return -hand.bet_amount;
  }
}

export default function BlackjackTable() {
  const { user, setUser } = useAuth();
  const [session, setSession] = useState<BlackjackSession | null>(null);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [blackjackEnabled, setBlackjackEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [betAmount, setBetAmount] = useState('');
  const [joining, setJoining] = useState(false);
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState<BlackjackHistoryEntry[]>([]);
  const [rtp, setRtp] = useState<number | null>(null);

  const loadHistory = useCallback(() => {
    blackjackApi
      .getMyHistory(10)
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const load = useCallback(async () => {
    try {
      const result = await blackjackApi.getCurrentSession();
      setSession(result.session);
      setBlackjackEnabled(result.enabled);
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
      .then((games) => setRtp(games.find((g) => g.id === 'blackjack')?.rtp ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Cliquetis de jeton dès qu'un joueur (soi-même ou un autre) s'assoit à la table.
  const prevHandCount = useRef<number | null>(null);
  const prevSessionId = useRef<number | null>(null);
  useEffect(() => {
    if (!session) return;
    if (prevSessionId.current !== session.id) {
      prevSessionId.current = session.id;
      prevHandCount.current = session.hands.length;
      return;
    }
    if (prevHandCount.current !== null && session.hands.length > prevHandCount.current) {
      sound.playChip();
    }
    prevHandCount.current = session.hands.length;
  }, [session]);

  // Jingle de résultat dès que la manche se termine, selon l'issue du joueur local.
  const prevStatus = useRef<BlackjackSession['status'] | undefined>(undefined);
  useEffect(() => {
    if (!session) return;
    if (session.status === 'finished' && prevStatus.current !== 'finished') {
      const mine = session.hands.find((h) => h.user_id === user?.id);
      if (mine?.outcome === 'blackjack') sound.playBlackjackWin();
      else if (mine?.outcome === 'win') sound.playWin();
      else if (mine?.outcome === 'push') sound.playPush();
      else if (mine?.outcome === 'lose') sound.playLose();
      if (mine) loadHistory();
    }
    prevStatus.current = session.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    sound.unlockAudio();
    const amount = Number(betAmount);
    if (!Number.isInteger(amount) || amount <= 0) return;
    setJoining(true);
    setError(null);
    try {
      const result = await blackjackApi.join(amount);
      setSession(result.session);
      setBlackjackEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      setBetAmount('');
      gamblingApi.getStatus().then(setStatus).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setJoining(false);
    }
  }

  async function handleHit() {
    sound.unlockAudio();
    setActing(true);
    setError(null);
    try {
      const result = await blackjackApi.hit();
      setSession(result.session);
      setBlackjackEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setActing(false);
    }
  }

  async function handleStand() {
    sound.unlockAudio();
    setActing(true);
    setError(null);
    try {
      const result = await blackjackApi.stand();
      setSession(result.session);
      setBlackjackEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setActing(false);
    }
  }

  const myHand = session?.hands.find((h) => h.user_id === user?.id);
  const seatsLeft = session ? MAX_SEATS - session.hands.length : 0;
  const canJoin = session?.status === 'waiting' && !myHand && seatsLeft > 0;
  const canAct =
    !!myHand &&
    myHand.status === 'playing' &&
    myHand.id === session?.current_hand_id &&
    session?.status === 'active';
  const startsIn = session?.starts_at ? secondsUntil(session.starts_at, now) : null;

  const dealerRevealed = session?.dealer_hole_revealed ?? false;
  const dealerTotal =
    dealerRevealed && session ? handValue(session.dealer_cards as BlackjackCard[]) : null;

  const canAfford = (user?.sp_balance ?? 0) >= (Number(betAmount) || 0);
  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);

  const orderedHands = session ? rotateToMeFirst(session.hands, user?.id) : [];

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/gambling" className="text-sm text-emerald-400 font-medium">
          ← Jeux
        </Link>

        <div className="flex items-center justify-between mt-4 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-50">Blackjack</h1>
            {rtp !== null && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
                {rtp}% redistribués
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {session && (
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  session.status === 'active'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : session.status === 'waiting'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {session.status === 'active'
                  ? 'En cours'
                  : session.status === 'waiting'
                    ? 'En attente de joueurs'
                    : 'Terminée'}
              </span>
            )}
            <VolumeSlider />
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {status && <GamblingBudgetBar status={{ ...status, enabled: blackjackEnabled }} />}

        {loading || !session ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            {session.status === 'waiting' && session.starts_at && (
              <p className="text-center text-amber-400 text-sm font-medium mb-4">
                La partie démarre dans {startsIn}s…
              </p>
            )}

            <div className="relative w-full max-w-xl mx-auto aspect-square mb-4">
              <div className="absolute inset-6 rounded-full bg-emerald-950/40 border border-emerald-900/50" />

              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <p className="text-xs text-zinc-400 uppercase mb-1.5 tracking-wide font-medium">
                  Croupier
                </p>
                <DealerCards cards={session.dealer_cards} />
                {dealerTotal !== null && (
                  <p className="text-sm text-zinc-100 font-semibold mt-1.5">{dealerTotal}</p>
                )}
              </div>

              {orderedHands.map((h, i) => {
                const { x, y, dealOrigin } = seatLayout(i, orderedHands.length);
                return (
                  <div
                    key={h.id}
                    className="absolute"
                    style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <BlackjackSeat
                      hand={h}
                      isMe={h.user_id === user?.id}
                      isCurrentTurn={h.id === session.current_hand_id}
                      now={now}
                      dealOrigin={dealOrigin}
                      seatIndex={i}
                    />
                  </div>
                );
              })}

              {session.status === 'finished' && (
                <div className="absolute inset-0 z-20 bg-zinc-950/85 backdrop-blur-sm flex items-center justify-center p-6">
                  <div
                    className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/40 p-4 w-full max-w-xs"
                    style={{ animation: 'popIn 0.35s ease-out' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-zinc-200">Manche terminée</h2>
                      {dealerTotal !== null && (
                        <span className="text-xs text-zinc-500">Croupier : {dealerTotal}</span>
                      )}
                    </div>
                    <ul className="divide-y divide-zinc-800">
                      {session.hands.map((h) => {
                        const net = netResult(h);
                        return (
                          <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar
                                username={h.username}
                                avatarUrl={h.avatar_url}
                                size={24}
                                frameUrl={h.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                              />
                              <div className="min-w-0">
                                <p className="text-zinc-300 truncate flex items-center gap-1">
                                  <UserNameTag
                                    username={h.user_id === user?.id ? 'Toi' : h.username}
                                    equipped={h.equipped_cosmetics}
                                    className="text-zinc-300"
                                  />
                                  {h.outcome === 'blackjack' && (
                                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium uppercase tracking-wide">
                                      Blackjack
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-zinc-500">
                                  {h.status === 'busted' ? 'Dépassé' : handValue(h.cards)}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`font-semibold flex-shrink-0 ${
                                net > 0
                                  ? 'text-emerald-400'
                                  : net < 0
                                    ? 'text-red-400'
                                    : 'text-zinc-500'
                              }`}
                            >
                              {net === 0 ? 'Égalité' : net > 0 ? `+${net} SP` : `${net} SP`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {orderedHands.length === 0 && (
              <p className="text-sm text-zinc-500 text-center mb-4">
                Aucun joueur à cette table pour l'instant.
              </p>
            )}

            {canJoin && (
              <form
                onSubmit={handleJoin}
                className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-4"
              >
                <p className="text-sm font-medium text-zinc-200 mb-2">
                  Rejoindre la table ({seatsLeft} place{seatsLeft > 1 ? 's' : ''} restante
                  {seatsLeft > 1 ? 's' : ''})
                </p>
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
                    disabled={joining || !betAmount || !canAfford || !blackjackEnabled}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                  >
                    {joining ? 'Mise…' : 'Miser'}
                  </button>
                </div>
                {betAmount && !canAfford && (
                  <p className="text-xs text-red-400 mt-2">Solde SP insuffisant.</p>
                )}
                <p className="text-xs text-zinc-500 mt-2">
                  Il te reste {budgetLeft} SP de budget gambling aujourd'hui.
                </p>
              </form>
            )}

            {myHand?.status === 'playing' && session.status === 'active' && !canAct && (
              <p className="text-center text-sm text-zinc-500 mb-4">
                En attente du tour des autres joueurs…
              </p>
            )}

            {canAct && (
              <div className="flex gap-2 mb-4">
                <button
                  onClick={handleHit}
                  disabled={acting}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-3 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                >
                  Tirer
                </button>
                <button
                  onClick={handleStand}
                  disabled={acting}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold px-4 py-3 rounded-md transition transform active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                >
                  Rester
                </button>
              </div>
            )}
          </>
        )}

        {history.length > 0 && (
          <div className="mt-2">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
              Historique de tes parties
            </h2>
            <ul className="space-y-2">
              {history.map((h) => {
                const net = netResult(h);
                const dealerFinal = handValue(h.dealer_cards);
                const myFinal = h.status === 'busted' ? 'Dépassé' : handValue(h.cards);
                return (
                  <li
                    key={h.id}
                    className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-zinc-300">
                        Mise {h.bet_amount} SP
                        {h.outcome === 'blackjack' && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium uppercase tracking-wide">
                            Blackjack
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Toi : {myFinal} · Croupier : {dealerFinal}
                      </p>
                    </div>
                    <span
                      className={`font-semibold flex-shrink-0 ${
                        net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-zinc-500'
                      }`}
                    >
                      {net === 0 ? 'Égalité' : net > 0 ? `+${net} SP` : `${net} SP`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
