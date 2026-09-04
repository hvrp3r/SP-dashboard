import { useEffect, useState, type FormEvent } from 'react';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import * as cosmeticsApi from '../../api/cosmetics.js';
import * as usersApi from '../../api/users.js';
import CosmeticPreview from '../../components/CosmeticPreview.jsx';
import {
  FONT_FALLBACK_LABELS,
  RARITIES,
  RARITY_LABELS,
  SLOT_LABELS,
  SUGGESTED_FONTS,
} from '../../lib/cosmeticsLabels.js';
import {
  buildFontFamilyValue,
  extractFontName,
  loadGoogleFont,
  parseFontFamilyValue,
  type FontFallback,
} from '../../lib/googleFonts.js';
import type { AdminUserSummary, Cosmetic, CosmeticRarity, CosmeticSlot } from '../../types.js';

const SLOTS: CosmeticSlot[] = ['avatar_frame', 'banner', 'name_color', 'title', 'name_font'];
const FONT_FALLBACKS: FontFallback[] = ['sans-serif', 'serif', 'monospace', 'cursive'];

interface CatalogDraft {
  name: string;
  description: string;
  imageUrl: string;
  colorValue: string;
  fontFamily: string;
  rarity: CosmeticRarity;
}

function draftFromCosmetic(c: Cosmetic): CatalogDraft {
  return {
    name: c.name,
    description: c.description ?? '',
    imageUrl: c.image_url ?? '',
    colorValue: c.color_value ?? '#60a5fa',
    fontFamily: c.font_family ?? '',
    rarity: c.rarity,
  };
}

export default function AdminCosmetics() {
  const confirm = useConfirm();

  const [catalog, setCatalog] = useState<Cosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [players, setPlayers] = useState<AdminUserSummary[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [catalogDrafts, setCatalogDrafts] = useState<Record<number, CatalogDraft>>({});
  const [savingCatalogId, setSavingCatalogId] = useState<number | null>(null);

  const [newSlot, setNewSlot] = useState<CosmeticSlot>('avatar_frame');
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newColorValue, setNewColorValue] = useState('#60a5fa');
  const [newFontName, setNewFontName] = useState('');
  const [newFontFallback, setNewFontFallback] = useState<FontFallback>('sans-serif');
  const [newRarity, setNewRarity] = useState<CosmeticRarity>('common');
  const [creating, setCreating] = useState(false);

  const [grantUserId, setGrantUserId] = useState('');
  const [grantCosmeticId, setGrantCosmeticId] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const cat = await cosmeticsApi.getCatalog();
      setCatalog(cat);
      setCatalogDrafts(Object.fromEntries(cat.map((c) => [c.id, draftFromCosmetic(c)])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    usersApi.listAllUsers().then(setPlayers).catch(() => {});
  }, []);

  // Précharge toutes les polices du catalogue, pour que les aperçus s'affichent
  // sans attendre un enregistrement.
  useEffect(() => {
    for (const c of catalog) {
      if (c.slot === 'name_font') loadGoogleFont(extractFontName(c.font_family));
    }
  }, [catalog]);

  // Aperçu en direct pendant la saisie du nom de police (créateur) — léger
  // debounce pour ne pas spammer Google Fonts à chaque frappe.
  useEffect(() => {
    if (newSlot !== 'name_font' || !newFontName.trim()) return;
    const timeout = setTimeout(() => loadGoogleFont(newFontName.trim()), 400);
    return () => clearTimeout(timeout);
  }, [newSlot, newFontName]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newKey.trim() || !newName.trim()) return;
    if (newSlot === 'name_font' && !newFontName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await cosmeticsApi.createCosmetic({
        slot: newSlot,
        key: newKey.trim(),
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        imageUrl:
          newSlot === 'avatar_frame' || newSlot === 'banner'
            ? newImageUrl.trim() || undefined
            : undefined,
        colorValue: newSlot === 'name_color' || newSlot === 'title' ? newColorValue : undefined,
        fontFamily:
          newSlot === 'name_font' ? buildFontFamilyValue(newFontName, newFontFallback) : undefined,
        rarity: newRarity,
      });
      setNewKey('');
      setNewName('');
      setNewDescription('');
      setNewImageUrl('');
      setNewFontName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveCatalogItem(cosmetic: Cosmetic) {
    const draft = catalogDrafts[cosmetic.id];
    if (!draft) return;
    setSavingCatalogId(cosmetic.id);
    setError(null);
    try {
      await cosmeticsApi.updateCosmetic(cosmetic.id, {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        imageUrl:
          cosmetic.slot === 'avatar_frame' || cosmetic.slot === 'banner'
            ? draft.imageUrl.trim() || null
            : undefined,
        colorValue:
          cosmetic.slot === 'name_color' || cosmetic.slot === 'title' ? draft.colorValue : undefined,
        fontFamily: cosmetic.slot === 'name_font' ? draft.fontFamily : undefined,
        rarity: draft.rarity,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingCatalogId(null);
    }
  }

  async function handleDelete(cosmetic: Cosmetic) {
    const ok = await confirm({
      title: 'Supprimer ce cosmétique',
      message: `« ${cosmetic.name} » sera définitivement supprimé du catalogue. Les joueurs qui le possèdent le perdront ; celui ou ceux qui l'avaient équipé retomberont sur le défaut de l'emplacement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    setDeletingId(cosmetic.id);
    setError(null);
    try {
      await cosmeticsApi.removeCosmetic(cosmetic.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    if (!grantUserId || !grantCosmeticId) return;
    setGranting(true);
    setGrantMessage(null);
    setError(null);
    try {
      await cosmeticsApi.grant(Number(grantUserId), Number(grantCosmeticId));
      setGrantMessage('Cosmétique octroyé.');
      setGrantUserId('');
      setGrantCosmeticId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setGranting(false);
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
        <p className="text-sm text-zinc-500 mb-6">
          Catalogue, octroi manuel et édition des cadres, fonds de profil, couleurs, polices et
          titres proposés aux joueurs.
        </p>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Créer un cosmétique</h2>
          <form onSubmit={handleCreate} className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={newSlot}
                onChange={(e) => setNewSlot(e.target.value as CosmeticSlot)}
                className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={newRarity}
                onChange={(e) => setNewRarity(e.target.value as CosmeticRarity)}
                className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {RARITY_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              required
              maxLength={50}
              placeholder="Clé unique (ex: frame_dragon)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="text"
              required
              maxLength={100}
              placeholder="Nom affiché"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <textarea
              placeholder="Description (optionnel)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {newSlot === 'name_color' || newSlot === 'title' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newColorValue}
                    onChange={(e) => setNewColorValue(e.target.value)}
                    className="h-10 w-14 rounded-md border border-zinc-700 bg-zinc-950"
                  />
                  <span className="text-sm text-zinc-400">{newColorValue}</span>
                </div>
                {newSlot === 'title' && newName.trim() && (
                  <span
                    className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-semibold"
                    style={{
                      borderColor: `${newColorValue}66`,
                      backgroundColor: `${newColorValue}1a`,
                      color: newColorValue,
                    }}
                  >
                    {newName.trim()}
                  </span>
                )}
              </div>
            ) : newSlot === 'name_font' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="Nom de la police Google Fonts (ex: Fredoka)"
                    value={newFontName}
                    onChange={(e) => setNewFontName(e.target.value)}
                    className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <select
                    value={newFontFallback}
                    onChange={(e) => setNewFontFallback(e.target.value as FontFallback)}
                    className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {FONT_FALLBACKS.map((f) => (
                      <option key={f} value={f}>
                        {FONT_FALLBACK_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {SUGGESTED_FONTS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setNewFontName(name)}
                      className="text-xs px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {newFontName.trim() && (
                  <p
                    className="text-lg text-zinc-100 border border-zinc-800 rounded-md px-3 py-2"
                    style={{ fontFamily: buildFontFamilyValue(newFontName, newFontFallback) }}
                  >
                    Aperçu : {newFontName.trim()}
                  </p>
                )}
                <p className="text-xs text-zinc-500">
                  N'importe quel nom de police disponible sur{' '}
                  <a
                    href="https://fonts.google.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    Google Fonts
                  </a>{' '}
                  — chargée automatiquement, sans mise à jour du site.
                </p>
              </div>
            ) : (
              <input
                type="text"
                placeholder="URL de l'image (optionnel)"
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            )}
            <button
              type="submit"
              disabled={creating}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              Créer
            </button>
          </form>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
          <h2 className="font-semibold text-zinc-200 mb-3">Octroyer manuellement</h2>
          <form onSubmit={handleGrant} className="flex items-center gap-2 flex-wrap">
            <select
              required
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
              className="flex-1 min-w-[140px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Joueur…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username}
                </option>
              ))}
            </select>
            <select
              required
              value={grantCosmeticId}
              onChange={(e) => setGrantCosmeticId(e.target.value)}
              className="flex-1 min-w-[140px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Cosmétique…</option>
              {catalog
                .filter((c) => !c.is_default)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {SLOT_LABELS[c.slot]} — {c.name}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              disabled={granting}
              className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-2 rounded-md transition disabled:opacity-50"
            >
              {granting ? '…' : 'Offrir'}
            </button>
          </form>
          {grantMessage && <p className="text-xs text-emerald-400 mt-2">{grantMessage}</p>}
        </div>

        {SLOTS.map((slot) => {
          const items = catalog.filter((c) => c.slot === slot);
          if (items.length === 0) return null;
          return (
            <div key={slot} className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md overflow-hidden mb-6">
              <div className="p-4 border-b border-zinc-800">
                <h2 className="font-semibold text-zinc-200">{SLOT_LABELS[slot]}</h2>
                {(slot === 'avatar_frame' || slot === 'banner') && (
                  <p className="text-xs text-zinc-500 mt-1">
                    Sans URL d'image, ce cosmétique n'affiche rien tant qu'une image n'est pas
                    ajoutée ici.
                  </p>
                )}
              </div>
              <ul className="divide-y divide-zinc-800">
                {items.map((c) => {
                  const draft = catalogDrafts[c.id] ?? draftFromCosmetic(c);
                  return (
                    <li key={c.id} className="p-4 space-y-2">
                      <div className="flex items-center gap-3">
                        <CosmeticPreview
                          cosmetic={{
                            ...c,
                            name: draft.name,
                            rarity: draft.rarity,
                            color_value: draft.colorValue,
                            image_url: draft.imageUrl || null,
                            font_family: draft.fontFamily || null,
                          }}
                          size={40}
                        />
                        <div className="min-w-0 flex-1">
                          <input
                            type="text"
                            value={draft.name}
                            onChange={(e) =>
                              setCatalogDrafts((prev) => ({
                                ...prev,
                                [c.id]: { ...draft, name: e.target.value },
                              }))
                            }
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          {c.is_default && (
                            <p className="text-xs text-zinc-500 mt-1 uppercase">Défaut</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={deletingId === c.id}
                          className="flex-shrink-0 text-sm text-red-400 font-medium hover:underline disabled:opacity-50"
                        >
                          {deletingId === c.id ? '…' : 'Supprimer'}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.slot === 'name_color' || c.slot === 'title' ? (
                          <>
                            <input
                              type="color"
                              value={draft.colorValue}
                              onChange={(e) =>
                                setCatalogDrafts((prev) => ({
                                  ...prev,
                                  [c.id]: { ...draft, colorValue: e.target.value },
                                }))
                              }
                              className="h-9 w-12 rounded-md border border-zinc-700 bg-zinc-950"
                            />
                            {c.slot === 'title' && (
                              <span
                                className="text-[10px] px-2 py-0.5 rounded-full border font-semibold"
                                style={{
                                  borderColor: `${draft.colorValue}66`,
                                  backgroundColor: `${draft.colorValue}1a`,
                                  color: draft.colorValue,
                                }}
                              >
                                {draft.name}
                              </span>
                            )}
                          </>
                        ) : c.slot === 'name_font' ? (
                          (() => {
                            const { name: fontName, fallback: fontFallback } = parseFontFamilyValue(
                              draft.fontFamily
                            );
                            return (
                              <>
                                <input
                                  type="text"
                                  placeholder="Nom de la police Google Fonts"
                                  value={fontName}
                                  onChange={(e) => {
                                    loadGoogleFont(e.target.value.trim());
                                    setCatalogDrafts((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...draft,
                                        fontFamily: buildFontFamilyValue(e.target.value, fontFallback),
                                      },
                                    }));
                                  }}
                                  className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <select
                                  value={fontFallback}
                                  onChange={(e) =>
                                    setCatalogDrafts((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...draft,
                                        fontFamily: buildFontFamilyValue(
                                          fontName,
                                          e.target.value as FontFallback
                                        ),
                                      },
                                    }))
                                  }
                                  className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                  {FONT_FALLBACKS.map((f) => (
                                    <option key={f} value={f}>
                                      {FONT_FALLBACK_LABELS[f]}
                                    </option>
                                  ))}
                                </select>
                              </>
                            );
                          })()
                        ) : c.slot === 'avatar_frame' || c.slot === 'banner' ? (
                          <input
                            type="text"
                            placeholder="URL de l'image"
                            value={draft.imageUrl}
                            onChange={(e) =>
                              setCatalogDrafts((prev) => ({
                                ...prev,
                                [c.id]: { ...draft, imageUrl: e.target.value },
                              }))
                            }
                            className="flex-1 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        ) : null}
                        <select
                          value={draft.rarity}
                          onChange={(e) =>
                            setCatalogDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draft, rarity: e.target.value as CosmeticRarity },
                            }))
                          }
                          className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          {RARITIES.map((r) => (
                            <option key={r} value={r}>
                              {RARITY_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSaveCatalogItem(c)}
                          disabled={savingCatalogId === c.id}
                          className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-50"
                        >
                          {savingCatalogId === c.id ? '…' : 'Enregistrer'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
