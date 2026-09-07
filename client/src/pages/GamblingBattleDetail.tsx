import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import * as battleApi from '../api/gamblingBattles.js';
import * as gamblingApi from '../api/gambling.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import CrateIcon from '../components/CrateIcon.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import GamblingBattleReel, { reelTravelledItems } from '../components/GamblingBattleReel.jsx';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import { rewardFallbackEmoji, rarityFromWeightPercent, type RewardRarity } from '../lib/gamblingLabels.js';
import { cosmeticRewardVisual } from '../lib/cosmeticsLabels.js';
import { syncServerClock, getServerNow } from '../lib/serverClock.js';
import * as sound from '../lib/sound.js';
import type {
  Cosmetic,
  CosmeticRarity,
  GamblingBattleCrateEntry,
  GamblingBattleOpenEntry,
  GamblingBattlePublicView,
  GamblingCrateRewardView,
  GamblingStatus,
} from '../types.js';

/** Sondage rapide même en salle d'attente : un joueur qui patiente pendant
 * qu'un autre rejoint doit voir la bataille démarrer (et son rouleau
 * s'animer) sans retard perceptible — celui qui rejoint voit le départ
 * instantanément (réponse directe de l'appel), mais les autres participants
 * déjà en salle n'apprennent le démarrage qu'au prochain sondage. */
const POLL_WAITING_MS = 1000;
const POLL_RUNNING_MS = 1000;
const TICK_MS = 80;

function statusBadge(status: GamblingBattlePublicView['status']): { label: string; className: string } {
  switch (status) {
    case 'waiting':
      return { label: 'En attente de joueurs', className: 'bg-amber-500/15 text-amber-400' };
    case 'in_progress':
      return { label: 'En cours', className: 'bg-emerald-500/15 text-emerald-400' };
    case 'completed':
      return { label: 'Terminée', className: 'bg-zinc-800 text-zinc-400' };
    default:
      return { label: 'Annulée', className: 'bg-red-500/15 text-red-400' };
  }
}

/** Petite puce compacte pour un tirage déjà révélé — placée avant le gros
 * rouleau "en cours" (voir plus bas), simple rappel du résultat obtenu. */
function PastChip({ open }: { open: GamblingBattleOpenEntry }) {
  const cosmetic = open.resolved_cosmetic;
  let visual: { icon: string; textClass: string; borderClass: string } | null = null;
  if (open.reward_type === 'cosmetic') {
    visual = cosmeticRewardVisual(cosmetic?.slot ?? null, cosmetic?.rarity ?? null);
  }
  const imageUrl = cosmetic?.image_url ?? open.reward_image_url;
  const title = cosmetic?.name ?? open.reward_title;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0" title={title}>
      <div
        className={`w-11 h-11 rounded-md flex items-center justify-center text-base bg-zinc-800 overflow-hidden ${
          visual ? `border ${visual.borderClass}` : 'border border-zinc-700'
        }`}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : visual ? (
          <span className={visual.textClass}>{visual.icon}</span>
        ) : (
          rewardFallbackEmoji(open.reward_type)
        )}
      </div>
      {open.sp_amount !== null && (
        <span className="text-[10px] text-emerald-400 font-semibold leading-none">+{open.sp_amount}</span>
      )}
    </div>
  );
}

/** Puce grisée pour une caisse pas encore ouverte — on sait déjà laquelle
 * s'en vient (image de la caisse), juste pas ce qu'elle va donner. */
function FutureChip({ crate }: { crate: GamblingBattleCrateEntry }) {
  return (
    <div
      className="w-11 h-11 rounded-md flex-shrink-0 flex items-center justify-center bg-zinc-950 border border-dashed border-zinc-800 opacity-50"
      title={crate.crate_name}
    >
      <CrateIcon imageUrl={crate.crate_image_url} size={26} />
    </div>
  );
}

export default function GamblingBattleDetail() {
  const { id } = useParams<{ id: string }>();
  const battleId = Number(id);
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const confirm = useConfirm();

  const [battle, setBattle] = useState<GamblingBattlePublicView | null>(null);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(getServerNow);

  const [rewardPools, setRewardPools] = useState<Record<number, GamblingCrateRewardView[]>>({});
  const [cosmeticCatalog, setCosmeticCatalog] = useState<Cosmetic[]>([]);
  const [rarityWeights, setRarityWeights] = useState<Record<CosmeticRarity, number> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await battleApi.getBattle(battleId);
      setBattle(result.battle);
      setEnabled(result.enabled);
      if (user) setUser({ ...user, sp_balance: result.balance });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ms = battle?.status === 'in_progress' ? POLL_RUNNING_MS : POLL_WAITING_MS;
    if (battle?.status === 'completed' || battle?.status === 'cancelled') return;
    const interval = setInterval(load, ms);
    return () => clearInterval(interval);
  }, [load, battle?.status]);

  useEffect(() => {
    gamblingApi.getStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    cosmeticsApi.getCatalog().then(setCosmeticCatalog).catch(() => {});
    cosmeticsApi.getRarityWeights().then(setRarityWeights).catch(() => {});
  }, []);

  // Charge le pool de récompenses (avec % normalisés) de chaque caisse distincte
  // de la bataille — nécessaire pour peupler la figuration du rouleau vertical
  // et estimer la rareté d'un tirage pour le son de révélation (voir plus bas).
  useEffect(() => {
    if (!battle) return;
    const distinctCrateIds = [...new Set(battle.crates.map((c) => c.crate_id))];
    const missing = distinctCrateIds.filter((id) => !(id in rewardPools));
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => gamblingApi.getCrate(id).then((c) => [id, c.rewards] as const)))
      .then((pairs) => {
        setRewardPools((prev) => {
          const next = { ...prev };
          for (const [id, rewards] of pairs) next[id] = rewards;
          return next;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.crates]);

  useEffect(() => {
    if (battle?.status !== 'in_progress') return;
    const interval = setInterval(() => setNow(getServerNow()), TICK_MS);
    return () => clearInterval(interval);
  }, [battle?.status]);

  useEffect(() => {
    syncServerClock().then(() => setNow(getServerNow()));
    const interval = setInterval(syncServerClock, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleJoin() {
    sound.unlockAudio();
    setJoining(true);
    setError(null);
    try {
      const result = await battleApi.joinBattle(battleId);
      setBattle(result.battle);
      if (user) setUser({ ...user, sp_balance: result.balance });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setJoining(false);
    }
  }

  async function handleCancel() {
    const ok = await confirm({
      title: 'Annuler la bataille',
      message: "Chaque participant déjà inscrit sera remboursé de son coût d'entrée.",
      confirmLabel: 'Annuler la bataille',
      danger: true,
    });
    if (!ok) return;
    setCancelling(true);
    setError(null);
    try {
      await battleApi.cancelBattle(battleId);
      navigate('/gambling/battles');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setCancelling(false);
    }
  }

  const totalSteps = battle?.crates.length ?? 0;
  const startedAtMs = battle?.started_at ? new Date(battle.started_at).getTime() : null;
  const elapsedMs = startedAtMs !== null ? Math.max(0, now - startedAtMs) : 0;
  const stepDurationMs = battle?.stepDurationMs ?? 6000;
  const activeStep =
    battle?.status === 'in_progress' && totalSteps > 0
      ? Math.min(totalSteps - 1, Math.floor(elapsedMs / stepDurationMs))
      : totalSteps - 1;
  const stepProgress =
    battle?.status === 'completed'
      ? 1
      : Math.min(1, Math.max(0, (elapsedMs - activeStep * stepDurationMs) / stepDurationMs));

  const openByKey = useMemo(() => {
    const map = new Map<string, GamblingBattleOpenEntry>();
    if (!battle) return map;
    for (const o of battle.opens) map.set(`${o.participant_id}:${o.position}`, o);
    return map;
  }, [battle]);

  /** Meilleure (plus rare) récompense tirée par n'importe quel participant à
   * une position donnée — sert à choisir le son de révélation joué une seule
   * fois pour tout le monde (voir l'effet de tics/révélation ci-dessous). */
  const bestRarityForPosition = useCallback(
    (position: number): RewardRarity => {
      const rank: Record<RewardRarity, number> = { common: 0, rare: 1, legendary: 2 };
      const crate = battle?.crates[position];
      const pool = crate ? rewardPools[crate.crate_id] : undefined;
      let best: RewardRarity = 'common';
      for (const o of battle?.opens ?? []) {
        if (o.position !== position) continue;
        let tier: RewardRarity;
        if (o.reward_type === 'cosmetic') {
          const rarity = o.resolved_cosmetic?.rarity;
          tier = rarity === 'legendary' || rarity === 'epic' ? 'legendary' : rarity === 'rare' || rarity === 'uncommon' ? 'rare' : 'common';
        } else {
          const percent = pool?.find((r) => r.id === o.reward_id)?.weight_percent ?? 100;
          tier = rarityFromWeightPercent(percent);
        }
        if (rank[tier] > rank[best]) best = tier;
      }
      return best;
    },
    [battle, rewardPools]
  );

  // Décollage au passage waiting -> in_progress, caisse enregistrée à chaque
  // franchissement d'emplacement du rouleau partagé, révélation à l'arrêt —
  // un seul son par évènement pour toute la bataille (pas un par colonne),
  // sans quoi 6 joueurs simultanés produiraient une cacophonie de tics
  // superposés au lieu d'un seul rouleau bien identifiable.
  const prevStatusRef = useRef<GamblingBattlePublicView['status'] | null>(null);
  useEffect(() => {
    if (!battle) return;
    if (prevStatusRef.current && prevStatusRef.current !== battle.status) {
      if (battle.status === 'in_progress') sound.playLiftoff();
      if (battle.status === 'completed') sound.playCashRegister();
    }
    prevStatusRef.current = battle.status;
  }, [battle?.status]);

  const lastTravelledRef = useRef(0);
  useEffect(() => {
    lastTravelledRef.current = 0;
  }, [activeStep]);

  const lastLandedStepRef = useRef(-1);
  useEffect(() => {
    if (!battle || battle.status !== 'in_progress' || totalSteps === 0) return;
    const travelledFloor = Math.floor(reelTravelledItems(stepProgress));
    if (travelledFloor > lastTravelledRef.current) {
      sound.playTick();
      lastTravelledRef.current = travelledFloor;
    }
    if (stepProgress >= 1 && lastLandedStepRef.current !== activeStep) {
      sound.playReveal(bestRarityForPosition(activeStep));
      lastLandedStepRef.current = activeStep;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepProgress, activeStep, battle?.status, totalSteps]);

  const isParticipant = battle?.participants.some((p) => p.user_id === user?.id) ?? false;
  const isCreator = battle?.created_by === user?.id;
  const isAdmin = user?.role === 'admin';
  const canJoin =
    battle?.status === 'waiting' && !isParticipant && battle.participants.length < battle.max_players;
  const canCancel = battle?.status === 'waiting' && (isCreator || isAdmin);
  const canAfford = (user?.sp_balance ?? 0) >= (battle?.cost_sp ?? 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-zinc-500">Chargement…</p>
        </div>
      </div>
    );
  }

  if (!battle) {
    return (
      <div className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <Link to="/gambling/battles" className="text-sm text-emerald-400 font-medium">
            ← Case Battle
          </Link>
          <p className="mt-4 text-zinc-500">Bataille introuvable.</p>
        </div>
      </div>
    );
  }

  const badge = statusBadge(battle.status);
  const maxTotal = Math.max(0, ...battle.participants.map((p) => p.revealed_sp_total));
  const showTimeline = battle.status !== 'waiting' && totalSteps > 0;
  const currentCrate = showTimeline ? battle.crates[activeStep] : undefined;
  const currentPool = currentCrate ? rewardPools[currentCrate.crate_id] : undefined;
  const pastPositions = showTimeline ? Array.from({ length: Math.max(0, activeStep) }, (_, i) => i) : [];
  const futurePositions = showTimeline
    ? Array.from({ length: Math.max(0, totalSteps - activeStep - 1) }, (_, i) => activeStep + 1 + i)
    : [];

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <Link to="/gambling/battles" className="text-sm text-emerald-400 font-medium">
          ← Case Battle
        </Link>

        <div className="flex items-center justify-between gap-2 mt-4 mb-2 flex-wrap">
          <h1 className="text-2xl font-bold text-zinc-50">Bataille #{battle.id}</h1>
          <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {status && <GamblingBudgetBar status={{ ...status, enabled }} />}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-6">
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {battle.crates.map((c) => (
              <span
                key={c.id}
                className={`inline-flex items-center gap-2 bg-zinc-950 border rounded-lg pl-1.5 pr-3 py-1.5 transition ${
                  showTimeline && c.position === activeStep ? 'border-emerald-500/60' : 'border-zinc-800'
                }`}
              >
                <CrateIcon imageUrl={c.crate_image_url} size={28} />
                <span className="leading-tight">
                  <span className="block text-sm text-zinc-200">{c.crate_name}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {c.crate_cost_sp > 0 ? `${c.crate_cost_sp} SP` : 'Gratuite'}
                  </span>
                </span>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-zinc-400">
              {battle.cost_sp} SP l'entrée · {battle.participants.length}/{battle.max_players} joueurs
            </span>

            <div className="ml-auto flex items-center gap-2">
              {canCancel && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                >
                  {cancelling ? 'Annulation…' : 'Annuler'}
                </button>
              )}
              {canJoin && (
                <button
                  onClick={handleJoin}
                  disabled={joining || !enabled || !canAfford}
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {joining ? 'Entrée…' : `Rejoindre (${battle.cost_sp} SP)`}
                </button>
              )}
            </div>
          </div>
        </div>

        {canJoin && !canAfford && (
          <p className="text-xs text-red-400 -mt-4 mb-6">Solde SP insuffisant pour rejoindre.</p>
        )}

        {battle.status === 'waiting' && (
          <p className="text-sm text-zinc-500 text-center mb-6">
            En attente d'autres joueurs ({battle.participants.length}/{battle.max_players})…
          </p>
        )}

        {battle.status === 'completed' && battle.winners.length > 0 && (
          <div
            className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl shadow-md p-4 mb-6 text-center"
            style={{ animation: 'popIn 0.4s ease-out' }}
          >
            <p className="text-sm text-emerald-400 font-semibold mb-1">
              🏆 {battle.winners.length > 1 ? 'Vainqueurs ex æquo' : 'Vainqueur'}
            </p>
            <p className="text-zinc-100 font-bold">
              {battle.winners.map((w) => w.username).join(', ')}
            </p>
            <p className="text-emerald-400 font-bold text-lg mt-1">
              +{battle.winners.reduce((sum, w) => sum + w.share_amount, 0)} SP au total
            </p>
          </div>
        )}

        <div className="overflow-x-auto pb-2">
          <div className="flex items-start gap-3 mx-auto" style={{ width: 'fit-content' }}>
            {battle.participants.map((p) => {
              const isWinner = battle.winners.some((w) => w.user_id === p.user_id);
              const isLeading = battle.status !== 'waiting' && p.revealed_sp_total === maxTotal && maxTotal > 0;
              const currentOpen = currentCrate ? openByKey.get(`${p.id}:${activeStep}`) : undefined;

              return (
                <div
                  key={p.id}
                  className={`flex-shrink-0 bg-zinc-900 border rounded-xl shadow-md p-3 ${
                    isWinner ? 'border-amber-500/50' : 'border-zinc-800'
                  }`}
                >
                  <div className="flex flex-col items-center text-center gap-1 mb-2">
                    <Avatar
                      username={p.username}
                      avatarUrl={p.avatar_url}
                      size={36}
                      frameUrl={p.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                    />
                    <div className="w-24 truncate">
                      <UserNameTag
                        username={p.user_id === user?.id ? 'Toi' : p.username}
                        equipped={p.equipped_cosmetics}
                        className="text-xs text-zinc-300"
                      />
                    </div>
                    <p
                      className={`text-sm font-bold ${
                        isWinner ? 'text-amber-400' : isLeading ? 'text-emerald-400' : 'text-zinc-500'
                      }`}
                    >
                      {isWinner && '🏆 '}
                      {p.revealed_sp_total} SP
                    </p>
                  </div>

                  {showTimeline && (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-44">
                        {currentOpen && currentPool ? (
                          <GamblingBattleReel
                            pool={currentPool}
                            result={currentOpen}
                            progress={battle.status === 'completed' ? 1 : stepProgress}
                            tickIntervalMs={TICK_MS}
                            cosmeticCatalog={cosmeticCatalog}
                            rarityWeights={rarityWeights}
                          />
                        ) : (
                          <div className="w-full h-[190px] rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-700 text-sm">
                            …
                          </div>
                        )}
                      </div>

                      {(pastPositions.length > 0 || futurePositions.length > 0) && (
                        <div className="flex items-center gap-1.5 flex-wrap justify-center">
                          {pastPositions.map((pos) => {
                            const open = openByKey.get(`${p.id}:${pos}`);
                            return open ? <PastChip key={pos} open={open} /> : null;
                          })}
                          {futurePositions.map((pos) => (
                            <FutureChip key={pos} crate={battle.crates[pos] as GamblingBattleCrateEntry} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
