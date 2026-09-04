import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import * as gamblingApi from '../api/gambling.js';
import * as cosmeticsApi from '../api/cosmetics.js';
import {
  RARITIES as COSMETIC_RARITIES,
  RARITY_LABELS,
  RARITY_TEXT_CLASSES as COSMETIC_RARITY_TEXT_CLASSES,
  SLOT_LABELS,
  cosmeticRewardVisual,
  poolRewardLabel,
} from '../lib/cosmeticsLabels.js';
import {
  RARITY_TEXT_CLASSES,
  REWARD_TYPE_LABELS,
  rarityFromWeightPercent,
  resetIntervalRecurrencePhrase,
  resetIntervalShortLabel,
  rewardFallbackEmoji,
} from '../lib/gamblingLabels.js';
import GamblingBudgetBar from '../components/GamblingBudgetBar.jsx';
import CosmeticPreview from '../components/CosmeticPreview.jsx';
import GamblingReel from '../components/GamblingReel.jsx';
import VolumeSlider from '../components/VolumeSlider.jsx';
import CrateIcon from '../components/CrateIcon.jsx';
import ResetIntervalField from '../components/ResetIntervalField.jsx';
import { unlockAudio } from '../lib/sound.js';
import type {
  Cosmetic,
  CosmeticRarity,
  CosmeticSlot,
  GamblingCrateDetail as CrateDetail,
  GamblingCrateReward,
  GamblingCrateRewardView,
  GamblingOpenEntry,
  GamblingOpenResult,
  GamblingRewardType,
  GamblingStatus,
} from '../types.js';

const COSMETIC_SLOTS: CosmeticSlot[] = ['avatar_frame', 'banner', 'name_color', 'title', 'name_font'];
type CosmeticRewardMode = 'exact' | 'pool';

function RewardIcon({
  reward,
  cosmeticCatalog,
  size = 40,
}: {
  reward: Pick<
    GamblingCrateReward,
    'type' | 'image_url' | 'cosmetic_id' | 'cosmetic_slot_filter' | 'cosmetic_rarity_filter'
  >;
  cosmeticCatalog: Cosmetic[];
  size?: number;
}) {
  if (reward.image_url) {
    return (
      <img
        src={reward.image_url}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-lg object-cover flex-shrink-0"
      />
    );
  }
  if (reward.type === 'cosmetic') {
    // Précis : catégorie/rareté du cosmétique visé. Pool : celles du filtre
    // (peut être partiel — ex: "Épique" seul, toutes catégories confondues).
    const exact = reward.cosmetic_id
      ? cosmeticCatalog.find((c) => c.id === reward.cosmetic_id)
      : null;
    const slot = exact?.slot ?? reward.cosmetic_slot_filter;
    const rarity = exact?.rarity ?? reward.cosmetic_rarity_filter;
    const visual = cosmeticRewardVisual(slot, rarity);
    return (
      <div
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
        className={`rounded-lg bg-zinc-800 border ${visual.borderClass} ${visual.textClass} flex items-center justify-center flex-shrink-0`}
      >
        {visual.icon}
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      className="rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0"
    >
      {rewardFallbackEmoji(reward.type)}
    </div>
  );
}

interface RewardDraft {
  title: string;
  imageUrl: string;
  spAmount: string;
  cosmeticId: string;
  cosmeticMode: CosmeticRewardMode;
  cosmeticSlotFilter: string;
  cosmeticRarityFilter: string;
  weight: string;
}

function draftFromReward(r: GamblingCrateReward): RewardDraft {
  return {
    title: r.title,
    imageUrl: r.image_url ?? '',
    spAmount: r.sp_amount !== null ? String(r.sp_amount) : '',
    cosmeticId: r.cosmetic_id !== null ? String(r.cosmetic_id) : '',
    cosmeticMode: r.cosmetic_id !== null ? 'exact' : 'pool',
    cosmeticSlotFilter: r.cosmetic_slot_filter ?? '',
    cosmeticRarityFilter: r.cosmetic_rarity_filter ?? '',
    weight: String(r.weight),
  };
}

export default function GamblingCrateDetail() {
  const { id } = useParams<{ id: string }>();
  const crateId = Number(id);
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'admin';

  const [crate, setCrate] = useState<CrateDetail | null>(null);
  const [status, setStatus] = useState<GamblingStatus | null>(null);
  const [opens, setOpens] = useState<GamblingOpenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [opening, setOpening] = useState(false);
  const [lastResult, setLastResult] = useState<GamblingOpenResult | null>(null);
  const [spinToken, setSpinToken] = useState(0);
  const [pendingWinner, setPendingWinner] = useState<GamblingCrateReward | null>(null);
  const pendingResultRef = useRef<GamblingOpenResult | null>(null);

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editCostSp, setEditCostSp] = useState('');
  const [editMaxOpensPerPlayer, setEditMaxOpensPerPlayer] = useState('');
  const [editResetIntervalDays, setEditResetIntervalDays] = useState('');
  const [editRequiresSubscription, setEditRequiresSubscription] = useState(false);
  const [savingCrate, setSavingCrate] = useState(false);
  const [deletingCrate, setDeletingCrate] = useState(false);

  const [newRewardType, setNewRewardType] = useState<GamblingRewardType>('sp');
  const [newRewardTitle, setNewRewardTitle] = useState('');
  const [newRewardImageUrl, setNewRewardImageUrl] = useState('');
  const [newRewardSpAmount, setNewRewardSpAmount] = useState('');
  const [newRewardCosmeticId, setNewRewardCosmeticId] = useState('');
  const [newRewardCosmeticMode, setNewRewardCosmeticMode] = useState<CosmeticRewardMode>('exact');
  const [newRewardCosmeticSlotFilter, setNewRewardCosmeticSlotFilter] = useState('');
  const [newRewardCosmeticRarityFilter, setNewRewardCosmeticRarityFilter] = useState('');
  const [newRewardWeight, setNewRewardWeight] = useState('');
  const [addingReward, setAddingReward] = useState(false);
  const [cosmeticCatalog, setCosmeticCatalog] = useState<Cosmetic[]>([]);

  const [rewardDrafts, setRewardDrafts] = useState<Record<number, RewardDraft>>({});
  const [savingRewardId, setSavingRewardId] = useState<number | null>(null);
  const [removingRewardId, setRemovingRewardId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await gamblingApi.getCrate(crateId);
      setCrate(data);
      setEditName(data.name);
      setEditDescription(data.description ?? '');
      setEditImageUrl(data.image_url ?? '');
      setEditCostSp(String(data.cost_sp));
      setEditMaxOpensPerPlayer(
        data.max_opens_per_player !== null ? String(data.max_opens_per_player) : ''
      );
      setEditResetIntervalDays(
        data.reset_interval_days !== null ? String(data.reset_interval_days) : ''
      );
      setEditRequiresSubscription(data.requires_subscription);
      setRewardDrafts(Object.fromEntries(data.rewards.map((r) => [r.id, draftFromReward(r)])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [crateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    gamblingApi.getStatus().then(setStatus).catch(() => {});
    gamblingApi.getMyOpens(10).then(setOpens).catch(() => {});
  }, [crateId]);

  useEffect(() => {
    // Chargé pour tout le monde (pas seulement le MSP) : sert aussi à afficher
    // l'icône/couleur par défaut des gains cosmétiques dans "Gains possibles".
    cosmeticsApi.getCatalog().then(setCosmeticCatalog).catch(() => {});
  }, []);

  // Suggère un titre à partir du filtre pool ("Titre + Épique"), sans écraser
  // un titre déjà saisi par le MSP.
  useEffect(() => {
    if (newRewardType !== 'cosmetic' || newRewardCosmeticMode !== 'pool') return;
    if (newRewardTitle.trim()) return;
    const label = poolRewardLabel(
      (newRewardCosmeticSlotFilter as CosmeticSlot) || null,
      (newRewardCosmeticRarityFilter as CosmeticRarity) || null
    );
    if (newRewardCosmeticSlotFilter || newRewardCosmeticRarityFilter) setNewRewardTitle(label);
  }, [newRewardType, newRewardCosmeticMode, newRewardCosmeticSlotFilter, newRewardCosmeticRarityFilter]);

  async function handleOpen() {
    unlockAudio();
    setOpening(true);
    setError(null);
    setLastResult(null);
    try {
      const result = await gamblingApi.openCrate(crateId);
      pendingResultRef.current = result;
      setPendingWinner(result.reward);
      setSpinToken((t) => t + 1);
      setStatus((prev) =>
        prev ? { ...prev, spentToday: result.spentToday, maxWagerPerDay: result.maxWagerPerDay } : prev
      );
      if (user) setUser({ ...user, sp_balance: result.balance });
      setCrate((prev) => (prev ? { ...prev, myOpenCount: prev.myOpenCount + 1 } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setOpening(false);
    }
  }

  function handleReelLanded() {
    setLastResult(pendingResultRef.current);
    pendingResultRef.current = null;
    setOpening(false);
    gamblingApi.getMyOpens(10).then(setOpens).catch(() => {});
  }

  async function handleSaveCrate(e: FormEvent) {
    e.preventDefault();
    setSavingCrate(true);
    setError(null);
    try {
      const updated = await gamblingApi.updateCrate(crateId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        imageUrl: editImageUrl.trim() || null,
        costSp: Number(editCostSp),
        maxOpensPerPlayer: editMaxOpensPerPlayer.trim() ? Number(editMaxOpensPerPlayer) : null,
        resetIntervalDays:
          editMaxOpensPerPlayer.trim() && editResetIntervalDays.trim()
            ? Number(editResetIntervalDays)
            : null,
        requiresSubscription: editRequiresSubscription,
      });
      setCrate((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingCrate(false);
    }
  }

  async function handleToggleActive() {
    if (!crate) return;
    setSavingCrate(true);
    setError(null);
    try {
      const updated = await gamblingApi.updateCrate(crateId, { isActive: !crate.is_active });
      setCrate((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingCrate(false);
    }
  }

  async function handleDeleteCrate() {
    if (!crate) return;
    const ok = await confirm({
      title: 'Supprimer la caisse',
      message: `« ${crate.name} » et ses gains configurés seront définitivement supprimés.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    setDeletingCrate(true);
    setError(null);
    try {
      await gamblingApi.removeCrate(crateId);
      navigate('/gambling/crates');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setDeletingCrate(false);
    }
  }

  async function handleAddReward(e: FormEvent) {
    e.preventDefault();
    if (!newRewardTitle.trim() || !newRewardWeight) return;
    if (newRewardType === 'sp' && !newRewardSpAmount) return;
    if (newRewardType === 'cosmetic') {
      if (newRewardCosmeticMode === 'exact' && !newRewardCosmeticId) return;
      if (
        newRewardCosmeticMode === 'pool' &&
        !newRewardCosmeticSlotFilter &&
        !newRewardCosmeticRarityFilter
      )
        return;
    }

    setAddingReward(true);
    setError(null);
    try {
      await gamblingApi.addReward(crateId, {
        type: newRewardType,
        title: newRewardTitle.trim(),
        imageUrl: newRewardImageUrl.trim() || undefined,
        spAmount: newRewardType === 'sp' ? Number(newRewardSpAmount) : undefined,
        cosmeticId:
          newRewardType === 'cosmetic' && newRewardCosmeticMode === 'exact'
            ? Number(newRewardCosmeticId)
            : undefined,
        cosmeticSlotFilter:
          newRewardType === 'cosmetic' && newRewardCosmeticMode === 'pool' && newRewardCosmeticSlotFilter
            ? (newRewardCosmeticSlotFilter as CosmeticSlot)
            : undefined,
        cosmeticRarityFilter:
          newRewardType === 'cosmetic' &&
          newRewardCosmeticMode === 'pool' &&
          newRewardCosmeticRarityFilter
            ? (newRewardCosmeticRarityFilter as CosmeticRarity)
            : undefined,
        weight: Number(newRewardWeight),
      });
      setNewRewardTitle('');
      setNewRewardImageUrl('');
      setNewRewardSpAmount('');
      setNewRewardCosmeticId('');
      setNewRewardCosmeticSlotFilter('');
      setNewRewardCosmeticRarityFilter('');
      setNewRewardWeight('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setAddingReward(false);
    }
  }

  async function handleSaveReward(reward: GamblingCrateRewardView) {
    const draft = rewardDrafts[reward.id];
    if (!draft) return;
    setSavingRewardId(reward.id);
    setError(null);
    try {
      await gamblingApi.updateReward(crateId, reward.id, {
        title: draft.title.trim(),
        imageUrl: draft.imageUrl.trim() || null,
        spAmount: reward.type === 'sp' ? Number(draft.spAmount) : null,
        cosmeticId:
          reward.type === 'cosmetic' && draft.cosmeticMode === 'exact'
            ? Number(draft.cosmeticId)
            : null,
        cosmeticSlotFilter:
          reward.type === 'cosmetic' && draft.cosmeticMode === 'pool' && draft.cosmeticSlotFilter
            ? (draft.cosmeticSlotFilter as CosmeticSlot)
            : null,
        cosmeticRarityFilter:
          reward.type === 'cosmetic' && draft.cosmeticMode === 'pool' && draft.cosmeticRarityFilter
            ? (draft.cosmeticRarityFilter as CosmeticRarity)
            : null,
        weight: Number(draft.weight),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingRewardId(null);
    }
  }

  async function handleRemoveReward(reward: GamblingCrateRewardView) {
    const ok = await confirm({
      title: 'Retirer ce gain',
      message: `« ${reward.title} » ne sera plus tirable dans cette caisse.`,
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!ok) return;
    setRemovingRewardId(reward.id);
    setError(null);
    try {
      await gamblingApi.removeReward(crateId, reward.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setRemovingRewardId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-zinc-500">Chargement…</p>
        </div>
      </div>
    );
  }

  if (!crate) {
    return (
      <div className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <Link to="/gambling/crates" className="text-sm text-emerald-400 font-medium">
            ← Caisses
          </Link>
          <p className="mt-4 text-zinc-500">Caisse introuvable.</p>
        </div>
      </div>
    );
  }

  const totalWeight = crate.rewards.reduce((sum, r) => sum + r.weight, 0);
  const expectedReturn =
    totalWeight > 0
      ? crate.rewards.reduce((sum, r) => sum + (r.sp_amount ?? 0) * r.weight, 0) / totalWeight
      : 0;

  const spentToday = status?.spentToday ?? 0;
  const maxWagerPerDay = status?.maxWagerPerDay ?? 0;
  const budgetLeft = Math.max(0, maxWagerPerDay - spentToday);
  const canAfford = (user?.sp_balance ?? 0) >= crate.cost_sp;
  const withinBudget = spentToday + crate.cost_sp <= maxWagerPerDay;
  const reachedOpenLimit =
    crate.max_opens_per_player !== null && crate.myOpenCount >= crate.max_opens_per_player;
  const subscriptionRequired = crate.requires_subscription && !(status?.subscriptionActive ?? false);
  const canOpen =
    crate.is_active &&
    (status?.enabled ?? true) &&
    canAfford &&
    withinBudget &&
    !reachedOpenLimit &&
    !subscriptionRequired &&
    !opening;
  const editFreeWithoutLimit = editCostSp.trim() === '0' && !editMaxOpensPerPlayer.trim();

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/gambling/crates" className="text-sm text-emerald-400 font-medium">
          ← Caisses
        </Link>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="flex items-center gap-3 mt-4 mb-2">
          <CrateIcon imageUrl={crate.image_url} size={48} />
          <div>
            <h1 className="text-2xl font-bold text-zinc-50">{crate.name}</h1>
            {crate.description && <p className="text-sm text-zinc-400">{crate.description}</p>}
          </div>
          {crate.requires_subscription && (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
              Abonnés
            </span>
          )}
          {isAdmin && !crate.is_active && (
            <span className="ml-auto flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium uppercase tracking-wide">
              Archivée
            </span>
          )}
        </div>

        {status && <GamblingBudgetBar status={status} />}

        <div className="relative bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6 text-center">
          <div className="absolute top-3 right-3">
            <VolumeSlider />
          </div>

          <button
            onClick={handleOpen}
            disabled={!canOpen}
            className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-6 py-3 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed transform hover:scale-105 active:scale-95"
          >
            {opening ? 'Ouverture…' : `Ouvrir (${crate.cost_sp > 0 ? `${crate.cost_sp} SP` : 'Gratuit'})`}
          </button>
          {crate.max_opens_per_player !== null && (
            <p className="text-xs text-zinc-500 mt-2">
              {crate.myOpenCount}/{crate.max_opens_per_player} ouvertures utilisées
              {crate.reset_interval_days !== null &&
                ` · ${resetIntervalShortLabel(crate.reset_interval_days)}`}
            </p>
          )}
          {reachedOpenLimit && (
            <p className="text-xs text-red-400 mt-2">
              Tu as atteint la limite d'ouvertures pour cette caisse.
              {crate.reset_interval_days !== null &&
                ` Elle se réinitialise ${resetIntervalRecurrencePhrase(crate.reset_interval_days)}.`}
            </p>
          )}
          {!reachedOpenLimit && subscriptionRequired && (
            <p className="text-xs text-red-400 mt-2">
              Réservée aux abonnés —{' '}
              <Link to="/profil" className="underline">
                voir comment s'abonner
              </Link>
              .
            </p>
          )}
          {!reachedOpenLimit && !subscriptionRequired && !canAfford && (
            <p className="text-xs text-red-400 mt-2">Solde SP insuffisant.</p>
          )}
          {!reachedOpenLimit && !subscriptionRequired && canAfford && !withinBudget && (
            <p className="text-xs text-red-400 mt-2">
              Budget quotidien atteint — il te reste {budgetLeft} SP à miser aujourd'hui.
            </p>
          )}

          {pendingWinner && (
            <div className="mt-6">
              <GamblingReel
                pool={crate.rewards}
                winner={pendingWinner}
                spinToken={spinToken}
                onLanded={handleReelLanded}
                cosmeticCatalog={cosmeticCatalog}
              />
            </div>
          )}

          {lastResult && (
            <div
              className="mt-4 flex flex-col items-center gap-2"
              style={{ animation: 'popIn 0.4s ease-out' }}
            >
              {lastResult.cosmetic && (
                <CosmeticPreview cosmetic={lastResult.cosmetic} size={72} />
              )}
              <p
                className={`text-lg font-bold ${
                  lastResult.cosmetic
                    ? COSMETIC_RARITY_TEXT_CLASSES[lastResult.cosmetic.rarity]
                    : RARITY_TEXT_CLASSES[
                        rarityFromWeightPercent(
                          crate.rewards.find((r) => r.id === lastResult.reward.id)?.weight_percent ?? 100
                        )
                      ]
                }`}
              >
                {lastResult.reward.title}
              </p>
              {lastResult.cosmetic && (
                <p className={`text-xs font-medium ${COSMETIC_RARITY_TEXT_CLASSES[lastResult.cosmetic.rarity]}`}>
                  {RARITY_LABELS[lastResult.cosmetic.rarity]} · {SLOT_LABELS[lastResult.cosmetic.slot]}
                </p>
              )}
              {lastResult.reward.type === 'sp' && (
                <p className="text-emerald-400 font-bold">+{lastResult.reward.sp_amount} SP</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-6">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="font-semibold text-zinc-200">Gains possibles</h2>
          </div>
          {crate.rewards.length === 0 ? (
            <p className="p-6 text-center text-zinc-500">Aucun gain configuré.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {crate.rewards.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <RewardIcon reward={r} cosmeticCatalog={cosmeticCatalog} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-100 font-medium truncate">{r.title}</p>
                    <p className="text-xs text-zinc-500">{REWARD_TYPE_LABELS[r.type]}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {r.type === 'sp' && (
                      <p className="text-emerald-400 font-bold">+{r.sp_amount} SP</p>
                    )}
                    <p className="text-xs text-zinc-500">{r.weight_percent}%</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {opens.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
              Tes dernières ouvertures
            </h2>
            <ul className="space-y-2">
              {opens.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="text-zinc-300">
                    {o.crate_name} — {o.reward_title}
                  </span>
                  {o.sp_amount !== null && (
                    <span className="text-emerald-400 font-bold">+{o.sp_amount} SP</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin && (
          <>
            <form
              onSubmit={handleSaveCrate}
              className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6"
            >
              <h2 className="font-semibold text-zinc-200 mb-3">Configurer la caisse</h2>
              <div className="space-y-2">
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  placeholder="Description"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  value={editImageUrl}
                  onChange={(e) => setEditImageUrl(e.target.value)}
                  placeholder="URL de l'image"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="number"
                  min={0}
                  required
                  value={editCostSp}
                  onChange={(e) => setEditCostSp(e.target.value)}
                  placeholder="Coût (SP, 0 = gratuit)"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="number"
                  min={1}
                  value={editMaxOpensPerPlayer}
                  onChange={(e) => {
                    setEditMaxOpensPerPlayer(e.target.value);
                    if (!e.target.value.trim()) setEditResetIntervalDays('');
                  }}
                  placeholder="Limite d'ouvertures par joueur (optionnel, illimité par défaut)"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {editMaxOpensPerPlayer.trim() && (
                  <ResetIntervalField
                    value={editResetIntervalDays}
                    onChange={setEditResetIntervalDays}
                  />
                )}
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editRequiresSubscription}
                    onChange={(e) => setEditRequiresSubscription(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                  />
                  Réservée aux abonnés (Ko-fi)
                </label>
                {editFreeWithoutLimit && (
                  <p className="text-xs text-red-400">
                    Une caisse gratuite doit avoir une limite d'ouvertures par joueur.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between mt-4 gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleActive}
                    disabled={savingCrate || deletingCrate}
                    className={`text-sm font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50 ${
                      crate.is_active
                        ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                    }`}
                  >
                    {crate.is_active ? 'Archiver la caisse' : 'Désarchiver la caisse'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCrate}
                    disabled={savingCrate || deletingCrate}
                    className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                  >
                    {deletingCrate ? 'Suppression…' : 'Supprimer la caisse'}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={savingCrate || deletingCrate || editFreeWithoutLimit}
                  className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-3">
                Espérance de gain : {expectedReturn.toFixed(1)} SP pour{' '}
                {crate.cost_sp > 0 ? `${crate.cost_sp} SP misés` : 'une ouverture gratuite'}
                {expectedReturn > crate.cost_sp && (
                  <span className="text-red-400"> — cette caisse est gagnante pour les joueurs en moyenne</span>
                )}
              </p>
            </form>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-6">
              <div className="p-4 border-b border-zinc-800">
                <h2 className="font-semibold text-zinc-200">Gérer les gains</h2>
              </div>

              {crate.rewards.length > 0 && (
                <ul className="divide-y divide-zinc-800">
                  {crate.rewards.map((r) => {
                    const draft = rewardDrafts[r.id] ?? draftFromReward(r);
                    return (
                      <li key={r.id} className="p-4 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
                            {REWARD_TYPE_LABELS[r.type]}
                          </span>
                          <input
                            type="text"
                            value={draft.title}
                            onChange={(e) =>
                              setRewardDrafts((prev) => ({
                                ...prev,
                                [r.id]: { ...draft, title: e.target.value },
                              }))
                            }
                            className="flex-1 min-w-[120px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="text"
                            value={draft.imageUrl}
                            onChange={(e) =>
                              setRewardDrafts((prev) => ({
                                ...prev,
                                [r.id]: { ...draft, imageUrl: e.target.value },
                              }))
                            }
                            placeholder="URL image"
                            className="flex-1 min-w-[120px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          {r.type === 'sp' && (
                            <input
                              type="number"
                              min={1}
                              value={draft.spAmount}
                              onChange={(e) =>
                                setRewardDrafts((prev) => ({
                                  ...prev,
                                  [r.id]: { ...draft, spAmount: e.target.value },
                                }))
                              }
                              placeholder="SP"
                              className="w-20 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                          )}
                          {r.type === 'cosmetic' && (
                            <>
                              <select
                                value={draft.cosmeticMode}
                                onChange={(e) =>
                                  setRewardDrafts((prev) => ({
                                    ...prev,
                                    [r.id]: {
                                      ...draft,
                                      cosmeticMode: e.target.value as CosmeticRewardMode,
                                    },
                                  }))
                                }
                                className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              >
                                <option value="exact">Précis</option>
                                <option value="pool">Pool</option>
                              </select>
                              {draft.cosmeticMode === 'exact' ? (
                                <select
                                  value={draft.cosmeticId}
                                  onChange={(e) =>
                                    setRewardDrafts((prev) => ({
                                      ...prev,
                                      [r.id]: { ...draft, cosmeticId: e.target.value },
                                    }))
                                  }
                                  className="flex-1 min-w-[140px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                  {cosmeticCatalog
                                    .filter((c) => !c.is_default)
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {SLOT_LABELS[c.slot]} — {c.name}
                                      </option>
                                    ))}
                                </select>
                              ) : (
                                <>
                                  <select
                                    value={draft.cosmeticSlotFilter}
                                    onChange={(e) =>
                                      setRewardDrafts((prev) => ({
                                        ...prev,
                                        [r.id]: { ...draft, cosmeticSlotFilter: e.target.value },
                                      }))
                                    }
                                    className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                  >
                                    <option value="">Toutes catégories</option>
                                    {COSMETIC_SLOTS.map((s) => (
                                      <option key={s} value={s}>
                                        {SLOT_LABELS[s]}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={draft.cosmeticRarityFilter}
                                    onChange={(e) =>
                                      setRewardDrafts((prev) => ({
                                        ...prev,
                                        [r.id]: { ...draft, cosmeticRarityFilter: e.target.value },
                                      }))
                                    }
                                    className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                  >
                                    <option value="">Toutes raretés</option>
                                    {COSMETIC_RARITIES.map((r2) => (
                                      <option key={r2} value={r2}>
                                        {RARITY_LABELS[r2]}
                                      </option>
                                    ))}
                                  </select>
                                </>
                              )}
                            </>
                          )}
                          <input
                            type="number"
                            min={1}
                            value={draft.weight}
                            onChange={(e) =>
                              setRewardDrafts((prev) => ({
                                ...prev,
                                [r.id]: { ...draft, weight: e.target.value },
                              }))
                            }
                            placeholder="Poids"
                            className="w-20 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <span className="text-xs text-zinc-500">{r.weight_percent}%</span>
                          <button
                            onClick={() => handleSaveReward(r)}
                            disabled={savingRewardId === r.id}
                            className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                          >
                            {savingRewardId === r.id ? '…' : 'Enregistrer'}
                          </button>
                          <button
                            onClick={() => handleRemoveReward(r)}
                            disabled={removingRewardId === r.id}
                            className="text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                          >
                            Retirer
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <form onSubmit={handleAddReward} className="p-4 border-t border-zinc-800 space-y-2">
                <p className="text-sm font-medium text-zinc-300">Ajouter un gain</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={newRewardType}
                    onChange={(e) => setNewRewardType(e.target.value as GamblingRewardType)}
                    className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="sp">SP classique</option>
                    <option value="custom">Personnalisé (collection)</option>
                    <option value="cosmetic">Cosmétique</option>
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="Titre"
                    value={newRewardTitle}
                    onChange={(e) => setNewRewardTitle(e.target.value)}
                    className="flex-1 min-w-[120px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    placeholder="URL image (optionnel)"
                    value={newRewardImageUrl}
                    onChange={(e) => setNewRewardImageUrl(e.target.value)}
                    className="flex-1 min-w-[120px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  {newRewardType === 'sp' && (
                    <input
                      type="number"
                      min={1}
                      required
                      placeholder="Montant SP"
                      value={newRewardSpAmount}
                      onChange={(e) => setNewRewardSpAmount(e.target.value)}
                      className="w-28 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  )}
                  {newRewardType === 'cosmetic' && (
                    <>
                      <select
                        value={newRewardCosmeticMode}
                        onChange={(e) => setNewRewardCosmeticMode(e.target.value as CosmeticRewardMode)}
                        className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="exact">Cosmétique précis</option>
                        <option value="pool">Pool catégorie/rareté</option>
                      </select>
                      {newRewardCosmeticMode === 'exact' ? (
                        <select
                          required
                          value={newRewardCosmeticId}
                          onChange={(e) => setNewRewardCosmeticId(e.target.value)}
                          className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="">Cosmétique…</option>
                          {cosmeticCatalog
                            .filter((c) => !c.is_default)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {SLOT_LABELS[c.slot]} — {c.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <>
                          <select
                            value={newRewardCosmeticSlotFilter}
                            onChange={(e) => setNewRewardCosmeticSlotFilter(e.target.value)}
                            className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="">Toutes catégories</option>
                            {COSMETIC_SLOTS.map((s) => (
                              <option key={s} value={s}>
                                {SLOT_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          <select
                            value={newRewardCosmeticRarityFilter}
                            onChange={(e) => setNewRewardCosmeticRarityFilter(e.target.value)}
                            className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="">Toutes raretés</option>
                            {COSMETIC_RARITIES.map((r) => (
                              <option key={r} value={r}>
                                {RARITY_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </>
                  )}
                  <input
                    type="number"
                    min={1}
                    required
                    placeholder="Poids"
                    value={newRewardWeight}
                    onChange={(e) => setNewRewardWeight(e.target.value)}
                    className="w-24 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={addingReward}
                    className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                  >
                    Ajouter
                  </button>
                </div>
                {newRewardType === 'cosmetic' && newRewardCosmeticMode === 'pool' && (
                  <p className="text-xs text-zinc-500">
                    Un cosmétique précis correspondant au filtre sera tiré au hasard à chaque
                    ouverture, pondéré par rareté (réglable dans Config → Cosmétiques).
                  </p>
                )}
                <p className="text-xs text-zinc-500">
                  Le poids détermine la probabilité relative de tirage (pas besoin que la somme
                  fasse 100 — les pourcentages sont recalculés automatiquement).
                </p>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
