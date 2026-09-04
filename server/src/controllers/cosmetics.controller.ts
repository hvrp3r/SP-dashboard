import type { Request, Response } from 'express';
import * as cosmeticsService from '../services/cosmetics.service.js';
import * as notificationService from '../services/notification.service.js';
import type { CosmeticRarity, CosmeticSlot } from '../types.js';

const VALID_SLOTS: CosmeticSlot[] = ['avatar_frame', 'banner', 'name_color', 'title', 'name_font'];
const VALID_RARITIES: CosmeticRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
/**
 * Le MSP peut saisir n'importe quel nom de police Google Fonts au runtime
 * (chargée dynamiquement côté client, voir client/src/lib/googleFonts.ts) —
 * pas de liste figée. On valide juste le *format* attendu ('"Nom", fallback')
 * plutôt qu'une valeur exacte, pour rester une simple valeur CSS inline-style
 * raisonnable (pas de guillemets/points-virgules imbriqués, longueur bornée).
 */
const FONT_FAMILY_PATTERN = /^"[A-Za-z0-9][A-Za-z0-9 '\-]{0,39}", (serif|sans-serif|monospace|cursive)$/;

export async function listCatalog(req: Request, res: Response): Promise<void> {
  const catalog = await cosmeticsService.listCatalog();
  res.json(catalog);
}

/** Poids de tirage par rareté — sert à afficher les taux de drop côté joueur (page Cosmétiques). */
export async function getRarityWeights(req: Request, res: Response): Promise<void> {
  const weights = await cosmeticsService.getRarityWeights();
  res.json(weights);
}

export async function getMine(req: Request, res: Response): Promise<void> {
  const owned = await cosmeticsService.getUserCosmetics(req.user!.id);
  const equipped = await cosmeticsService.getEquipped(req.user!.id);
  res.json({ owned, equipped });
}

export async function getForUser(req: Request<{ id: string }>, res: Response): Promise<void> {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  const equipped = await cosmeticsService.getEquipped(userId);
  res.json(equipped);
}

interface EquipBody {
  cosmeticId?: number | null;
  slot?: CosmeticSlot;
}

export async function equip(req: Request<{}, {}, EquipBody>, res: Response): Promise<void> {
  const cosmeticId = req.body?.cosmeticId;
  try {
    if (cosmeticId === null || cosmeticId === undefined) {
      const slot = req.body?.slot;
      if (!slot || !VALID_SLOTS.includes(slot)) {
        res.status(400).json({ error: 'Emplacement invalide' });
        return;
      }
      await cosmeticsService.unequip(req.user!.id, slot);
    } else {
      if (!Number.isInteger(cosmeticId)) {
        res.status(400).json({ error: 'Identifiant de cosmétique invalide' });
        return;
      }
      await cosmeticsService.equip(req.user!.id, cosmeticId);
    }
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  const equipped = await cosmeticsService.getEquipped(req.user!.id);
  res.json(equipped);
}

interface CreateCosmeticBody {
  slot?: CosmeticSlot;
  key?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  colorValue?: string;
  fontFamily?: string;
  rarity?: CosmeticRarity;
}

export async function createCosmetic(
  req: Request<{}, {}, CreateCosmeticBody>,
  res: Response
): Promise<void> {
  const slot = req.body?.slot;
  const key = req.body?.key?.trim();
  const name = req.body?.name?.trim();
  const description = req.body?.description?.trim();
  const imageUrl = req.body?.imageUrl?.trim();
  const colorValue = req.body?.colorValue?.trim();
  const fontFamily = req.body?.fontFamily?.trim();
  const rarity = req.body?.rarity ?? 'common';

  if (!slot || !VALID_SLOTS.includes(slot)) {
    res.status(400).json({ error: 'Emplacement invalide' });
    return;
  }
  if (!key) {
    res.status(400).json({ error: 'La clé est requise' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Le nom est requis' });
    return;
  }
  if (!VALID_RARITIES.includes(rarity)) {
    res.status(400).json({ error: 'Rareté invalide' });
    return;
  }
  if (fontFamily && !FONT_FAMILY_PATTERN.test(fontFamily)) {
    res.status(400).json({ error: 'Police invalide' });
    return;
  }

  let cosmetic;
  try {
    cosmetic = await cosmeticsService.createCosmetic({
      slot,
      key,
      name,
      description: description || null,
      imageUrl: imageUrl || null,
      colorValue: colorValue || null,
      fontFamily: fontFamily || null,
      rarity,
      createdBy: req.user!.id,
    });
  } catch (err) {
    const status = (err as { status?: number; code?: string }).code === '23505' ? 409 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(201).json(cosmetic);
}

interface UpdateCosmeticBody {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  colorValue?: string | null;
  fontFamily?: string | null;
  rarity?: CosmeticRarity;
}

export async function updateCosmetic(
  req: Request<{ id: string }, {}, UpdateCosmeticBody>,
  res: Response
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  const body = req.body ?? {};
  if (body.rarity !== undefined && !VALID_RARITIES.includes(body.rarity)) {
    res.status(400).json({ error: 'Rareté invalide' });
    return;
  }
  if (body.fontFamily && !FONT_FAMILY_PATTERN.test(body.fontFamily)) {
    res.status(400).json({ error: 'Police invalide' });
    return;
  }

  const updated = await cosmeticsService.updateCosmetic(id, {
    name: body.name?.trim(),
    description: body.description !== undefined ? body.description?.trim() || null : undefined,
    imageUrl: body.imageUrl !== undefined ? body.imageUrl?.trim() || null : undefined,
    colorValue: body.colorValue !== undefined ? body.colorValue?.trim() || null : undefined,
    fontFamily: body.fontFamily !== undefined ? body.fontFamily?.trim() || null : undefined,
    rarity: body.rarity,
  });
  if (!updated) {
    res.status(404).json({ error: 'Cosmétique introuvable' });
    return;
  }
  res.json(updated);
}

export async function removeCosmetic(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  try {
    await cosmeticsService.removeCosmetic(id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }
  res.status(204).end();
}

interface GrantBody {
  userId?: number;
  cosmeticId?: number;
}

export async function grant(req: Request<{}, {}, GrantBody>, res: Response): Promise<void> {
  const userId = req.body?.userId;
  const cosmeticId = req.body?.cosmeticId;
  if (!Number.isInteger(userId) || !Number.isInteger(cosmeticId)) {
    res.status(400).json({ error: 'Joueur et cosmétique requis' });
    return;
  }

  let cosmetic;
  try {
    cosmetic = await cosmeticsService.getCosmeticById(cosmeticId as number);
    if (!cosmetic) {
      res.status(404).json({ error: 'Cosmétique introuvable' });
      return;
    }
    await cosmeticsService.grant(userId as number, cosmeticId as number, 'admin_grant');
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  await notificationService.createNotification({
    userId: userId as number,
    type: 'cosmetic_earned',
    message: `Le MSP t'a offert le cosmétique « ${cosmetic.name} » !`,
    link: '/cosmetiques',
  });

  res.status(201).json({ ok: true });
}
