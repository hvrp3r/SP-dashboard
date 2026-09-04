import { useEffect, useState } from 'react';
import * as cosmeticsApi from '../api/cosmetics.js';
import CosmeticPreview from '../components/CosmeticPreview.jsx';
import {
  RARITIES,
  RARITY_BORDER_CLASSES,
  RARITY_LABELS,
  RARITY_TEXT_CLASSES,
  SLOT_LABELS,
} from '../lib/cosmeticsLabels.js';
import { extractFontName, loadGoogleFont } from '../lib/googleFonts.js';
import type { Cosmetic, CosmeticRarity, CosmeticSlot, EquippedCosmetic, UserCosmeticEntry } from '../types.js';

const SLOTS: CosmeticSlot[] = ['avatar_frame', 'banner', 'name_color', 'title', 'name_font'];

function CosmeticCard({
  cosmetic,
  status,
  onEquip,
  equipping,
}: {
  cosmetic: Cosmetic;
  status: 'equipped' | 'owned' | 'locked';
  onEquip: () => void;
  equipping: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 bg-zinc-900 border rounded-xl shadow-md p-4 ${RARITY_BORDER_CLASSES[cosmetic.rarity]} ${status === 'locked' ? 'opacity-50' : ''}`}
    >
      <CosmeticPreview cosmetic={cosmetic} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-100 truncate">{cosmetic.name}</p>
        {cosmetic.description && (
          <p className="text-xs text-zinc-500 truncate">{cosmetic.description}</p>
        )}
        <p className={`text-xs font-medium mt-0.5 ${RARITY_TEXT_CLASSES[cosmetic.rarity]}`}>
          {RARITY_LABELS[cosmetic.rarity]}
        </p>
      </div>
      {status === 'equipped' ? (
        <span className="flex-shrink-0 text-xs font-semibold text-emerald-400 px-3 py-1.5">
          Équipé ✓
        </span>
      ) : status === 'owned' ? (
        <button
          onClick={onEquip}
          disabled={equipping}
          className="flex-shrink-0 text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
        >
          {equipping ? '…' : 'Équiper'}
        </button>
      ) : (
        <span className="flex-shrink-0 text-xs text-zinc-600 px-3 py-1.5">Non obtenu</span>
      )}
    </div>
  );
}

export default function Cosmetics() {
  const [catalog, setCatalog] = useState<Cosmetic[]>([]);
  const [owned, setOwned] = useState<UserCosmeticEntry[]>([]);
  const [equipped, setEquipped] = useState<EquippedCosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [equippingId, setEquippingId] = useState<number | 'default' | null>(null);
  const [rarityWeights, setRarityWeights] = useState<Record<CosmeticRarity, number> | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const mine = await cosmeticsApi.getMine();
        setOwned(mine.owned);
        setEquipped(mine.equipped);
        const cat = await cosmeticsApi.getCatalog();
        setCatalog(cat);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    cosmeticsApi.getRarityWeights().then(setRarityWeights).catch(() => {});
  }, []);

  // Taux de drop affichés dans la légende : les poids configurés par le MSP
  // (utilisés pour le tirage des récompenses "pool" en caisse gambling),
  // normalisés en pourcentage sur l'ensemble des 5 raretés.
  const rarityPercents = (() => {
    if (!rarityWeights) return null;
    const total = RARITIES.reduce((sum, r) => sum + (rarityWeights[r] ?? 0), 0);
    if (total <= 0) return null;
    return Object.fromEntries(
      RARITIES.map((r) => [r, ((rarityWeights[r] ?? 0) / total) * 100])
    ) as Record<CosmeticRarity, number>;
  })();

  // Précharge toutes les polices du catalogue (équipées ou non), pour que les
  // aperçus s'affichent sans attendre un equip.
  useEffect(() => {
    for (const c of catalog) {
      if (c.slot === 'name_font') loadGoogleFont(extractFontName(c.font_family));
    }
  }, [catalog]);

  async function handleEquip(cosmetic: Cosmetic) {
    setEquippingId(cosmetic.is_default ? 'default' : cosmetic.id);
    setError(null);
    try {
      const result = cosmetic.is_default
        ? await cosmeticsApi.unequip(cosmetic.slot)
        : await cosmeticsApi.equip(cosmetic.id);
      setEquipped(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setEquippingId(null);
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

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-1">Cosmétiques</h1>
        <p className="text-sm text-zinc-500 mb-3">
          Équipe des cadres, fonds de profil, couleurs et polices de pseudo, et titres obtenus dans
          les caisses ou offerts par le MSP.
        </p>

        <div className="flex items-center gap-3 flex-wrap mb-1">
          {RARITIES.map((r) => (
            <span key={r} className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RARITY_TEXT_CLASSES[r].replace('text-', 'bg-')}`} />
              <span className={RARITY_TEXT_CLASSES[r]}>
                {RARITY_LABELS[r]}
                {rarityPercents && (
                  <span className="text-zinc-500"> · {rarityPercents[r].toFixed(1)}%</span>
                )}
              </span>
            </span>
          ))}
        </div>
        <p className="text-[11px] text-zinc-600 mb-6">
          Taux de tirage en caisse pour un cosmétique "surprise" (récompense pool), configurables
          par le MSP.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {SLOTS.map((slot) => {
          const items = catalog.filter((c) => c.slot === slot);
          const equippedKey = equipped.find((e) => e.slot === slot)?.key;
          return (
            <div key={slot} className="mb-8">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-3">
                {SLOT_LABELS[slot]}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((c) => {
                  const isOwned = c.is_default || owned.some((o) => o.cosmetic_id === c.id);
                  const status: 'equipped' | 'owned' | 'locked' =
                    c.key === equippedKey ? 'equipped' : isOwned ? 'owned' : 'locked';
                  return (
                    <CosmeticCard
                      key={c.id}
                      cosmetic={c}
                      status={status}
                      onEquip={() => handleEquip(c)}
                      equipping={equippingId === (c.is_default ? 'default' : c.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
