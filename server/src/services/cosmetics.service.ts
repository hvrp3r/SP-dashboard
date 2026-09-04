import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as configService from './config.service.js';
import type {
  CosmeticObtainedSource,
  CosmeticRarity,
  CosmeticRow,
  CosmeticSlot,
  EquippedCosmetic,
  UserCosmeticEntry,
} from '../types.js';

const RARITY_WEIGHT_DEFAULTS: Record<CosmeticRarity, number> = {
  common: 100,
  uncommon: 65,
  rare: 35,
  epic: 12,
  legendary: 4,
};

export async function listCatalog(): Promise<CosmeticRow[]> {
  const { rows } = await pool.query<CosmeticRow>(
    `SELECT * FROM cosmetics
     ORDER BY slot ASC, is_default DESC,
       CASE rarity
         WHEN 'common' THEN 1 WHEN 'uncommon' THEN 2 WHEN 'rare' THEN 3
         WHEN 'epic' THEN 4 WHEN 'legendary' THEN 5
       END ASC,
       created_at ASC`
  );
  return rows;
}

export async function getCosmeticById(id: number): Promise<CosmeticRow | null> {
  const { rows } = await pool.query<CosmeticRow>('SELECT * FROM cosmetics WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function getDefaults(): Promise<Record<CosmeticSlot, CosmeticRow>> {
  const { rows } = await pool.query<CosmeticRow>('SELECT * FROM cosmetics WHERE is_default = true');
  const bySlot = {} as Record<CosmeticSlot, CosmeticRow>;
  for (const row of rows) bySlot[row.slot] = row;
  return bySlot;
}

/**
 * Cosmétiques du catalogue correspondant à un filtre "pool" de récompense
 * gambling (catégorie et/ou rareté, `null` = pas de restriction sur cet axe).
 * Exclut toujours les défauts (`is_default`) : jamais gagnables en caisse.
 */
export async function listCosmeticsForPool(
  slotFilter: CosmeticSlot | null,
  rarityFilter: CosmeticRarity | null,
  db: Pool | PoolClient = pool
): Promise<CosmeticRow[]> {
  const { rows } = await db.query<CosmeticRow>(
    `SELECT * FROM cosmetics
     WHERE is_default = false
       AND ($1::text IS NULL OR slot = $1)
       AND ($2::text IS NULL OR rarity = $2)`,
    [slotFilter, rarityFilter]
  );
  return rows;
}

/**
 * Poids de tirage par rareté (config `cosmetic_rarity_weight_<rarity>`),
 * réutilisé par le tirage des pools gambling et par l'affichage des taux de
 * drop au joueur (voir cosmetics.controller.ts#getRarityWeights).
 */
export async function getRarityWeights(): Promise<Record<CosmeticRarity, number>> {
  const weights = await Promise.all(
    (['common', 'uncommon', 'rare', 'epic', 'legendary'] as CosmeticRarity[]).map(async (rarity) => [
      rarity,
      await configService.getConfigNumber(`cosmetic_rarity_weight_${rarity}`, RARITY_WEIGHT_DEFAULTS[rarity]),
    ] as const)
  );
  return Object.fromEntries(weights) as Record<CosmeticRarity, number>;
}

/**
 * Tire un cosmétique précis dans un pool "catégorie/rareté" — pondéré par
 * rareté (config `cosmetic_rarity_weight_<rarity>`) plutôt qu'uniformément,
 * pour qu'un légendaire reste plus rare qu'un commun même à l'intérieur d'un
 * même pool (ex: récompense "Cadre" seule, toutes raretés confondues).
 */
export async function pickRandomCosmeticForPool(
  slotFilter: CosmeticSlot | null,
  rarityFilter: CosmeticRarity | null,
  db: Pool | PoolClient = pool
): Promise<CosmeticRow> {
  const candidates = await listCosmeticsForPool(slotFilter, rarityFilter, db);
  if (candidates.length === 0) {
    throw Object.assign(new Error('Aucun cosmétique ne correspond à ce filtre'), { status: 409 });
  }

  const weightByRarity = await getRarityWeights();

  const totalWeight = candidates.reduce((sum, c) => sum + (weightByRarity[c.rarity] || 0), 0);
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)] as CosmeticRow;
  }
  let roll = Math.random() * totalWeight;
  for (const candidate of candidates) {
    roll -= weightByRarity[candidate.rarity] || 0;
    if (roll < 0) return candidate;
  }
  return candidates[candidates.length - 1] as CosmeticRow;
}

interface UserCosmeticJoinRow extends CosmeticRow {
  uc_id: number;
  equipped: boolean;
  obtained_source: CosmeticObtainedSource;
  obtained_at: string;
}

export async function getUserCosmetics(userId: number): Promise<UserCosmeticEntry[]> {
  const { rows } = await pool.query<UserCosmeticJoinRow>(
    `SELECT uc.id AS uc_id, uc.equipped, uc.obtained_source, uc.obtained_at, c.*
     FROM user_cosmetics uc
     JOIN cosmetics c ON c.id = uc.cosmetic_id
     WHERE uc.user_id = $1
     ORDER BY c.slot ASC, uc.obtained_at DESC`,
    [userId]
  );
  return rows.map(({ uc_id, equipped, obtained_source, obtained_at, ...cosmetic }) => ({
    id: uc_id,
    user_id: userId,
    cosmetic_id: cosmetic.id,
    slot: cosmetic.slot,
    equipped,
    obtained_source,
    obtained_at,
    cosmetic,
  }));
}

/**
 * Cosmétiques équipés d'un joueur, un par emplacement — retombe sur le
 * défaut de l'emplacement si rien n'est équipé (pas de ligne user_cosmetics
 * requise pour porter un défaut, voir la migration 024).
 */
export async function getEquipped(userId: number): Promise<EquippedCosmetic[]> {
  const map = await getEquippedForUsers([userId]);
  return map.get(userId) ?? [];
}

export async function getEquippedForUsers(userIds: number[]): Promise<Map<number, EquippedCosmetic[]>> {
  const result = new Map<number, EquippedCosmetic[]>();
  if (userIds.length === 0) return result;

  const defaults = await getDefaults();
  const { rows: equippedRows } = await pool.query<{
    user_id: number;
    slot: CosmeticSlot;
    key: string;
    name: string;
    image_url: string | null;
    color_value: string | null;
    font_family: string | null;
  }>(
    `SELECT uc.user_id, c.slot, c.key, c.name, c.image_url, c.color_value, c.font_family
     FROM user_cosmetics uc
     JOIN cosmetics c ON c.id = uc.cosmetic_id
     WHERE uc.user_id = ANY($1::int[]) AND uc.equipped = true`,
    [userIds]
  );

  const equippedByUser = new Map<number, Map<CosmeticSlot, EquippedCosmetic>>();
  for (const row of equippedRows) {
    const bySlot = equippedByUser.get(row.user_id) ?? new Map<CosmeticSlot, EquippedCosmetic>();
    bySlot.set(row.slot, {
      slot: row.slot,
      key: row.key,
      name: row.name,
      image_url: row.image_url,
      color_value: row.color_value,
      font_family: row.font_family,
    });
    equippedByUser.set(row.user_id, bySlot);
  }

  for (const userId of userIds) {
    const bySlot = equippedByUser.get(userId) ?? new Map<CosmeticSlot, EquippedCosmetic>();
    const entries: EquippedCosmetic[] = [];
    for (const slot of Object.keys(defaults) as CosmeticSlot[]) {
      const equipped = bySlot.get(slot);
      const fallback = defaults[slot];
      entries.push(
        equipped ?? {
          slot,
          key: fallback.key,
          name: fallback.name,
          image_url: fallback.image_url,
          color_value: fallback.color_value,
          font_family: fallback.font_family,
        }
      );
    }
    result.set(userId, entries);
  }
  return result;
}

/**
 * Octroie un cosmétique à un joueur (caisse gambling ou octroi MSP).
 * Idempotent : un octroi déjà possédé ne recrée pas de ligne. Accepte un
 * `client` optionnel pour composer avec la transaction d'ouverture de
 * caisse (même signature que creditSP/debitSP).
 */
export async function grant(
  userId: number,
  cosmeticId: number,
  source: CosmeticObtainedSource,
  client?: PoolClient
): Promise<void> {
  const db: Pool | PoolClient = client ?? pool;
  const cosmetic = await getCosmeticById(cosmeticId);
  if (!cosmetic) {
    throw Object.assign(new Error('Cosmétique introuvable'), { status: 404 });
  }
  await db.query(
    `INSERT INTO user_cosmetics (user_id, cosmetic_id, slot, obtained_source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
    [userId, cosmeticId, cosmetic.slot, source]
  );
}

/**
 * Équipe un cosmétique déjà possédé (ou retombe sur le défaut si
 * `cosmeticId` est null). Un seul cosmétique équipé par emplacement — même
 * verrouillage logique que le "un seul défaut par slot" en base.
 */
export async function equip(userId: number, cosmeticId: number | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let slot: CosmeticSlot;
    if (cosmeticId !== null) {
      const { rows } = await client.query<{ slot: CosmeticSlot }>(
        `SELECT c.slot FROM user_cosmetics uc JOIN cosmetics c ON c.id = uc.cosmetic_id
         WHERE uc.user_id = $1 AND uc.cosmetic_id = $2`,
        [userId, cosmeticId]
      );
      if (!rows[0]) {
        throw Object.assign(new Error('Tu ne possèdes pas ce cosmétique'), { status: 403 });
      }
      slot = rows[0].slot;
    } else {
      throw Object.assign(new Error('Emplacement requis pour retirer un cosmétique'), { status: 400 });
    }

    await client.query(
      'UPDATE user_cosmetics SET equipped = false WHERE user_id = $1 AND slot = $2 AND equipped = true',
      [userId, slot]
    );
    await client.query(
      'UPDATE user_cosmetics SET equipped = true WHERE user_id = $1 AND cosmetic_id = $2',
      [userId, cosmeticId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Retire le cosmétique équipé d'un emplacement — le joueur retombe sur le défaut. */
export async function unequip(userId: number, slot: CosmeticSlot): Promise<void> {
  await pool.query(
    'UPDATE user_cosmetics SET equipped = false WHERE user_id = $1 AND slot = $2 AND equipped = true',
    [userId, slot]
  );
}

interface CreateCosmeticInput {
  slot: CosmeticSlot;
  key: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  colorValue: string | null;
  fontFamily: string | null;
  rarity: CosmeticRarity;
  createdBy: number;
}

export async function createCosmetic(input: CreateCosmeticInput): Promise<CosmeticRow> {
  const { rows } = await pool.query<CosmeticRow>(
    `INSERT INTO cosmetics (slot, key, name, description, image_url, color_value, font_family, rarity, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.slot,
      input.key,
      input.name,
      input.description,
      input.imageUrl,
      input.colorValue,
      input.fontFamily,
      input.rarity,
      input.createdBy,
    ]
  );
  return rows[0] as CosmeticRow;
}

interface UpdateCosmeticInput {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  colorValue?: string | null;
  fontFamily?: string | null;
  rarity?: CosmeticRarity;
}

export async function updateCosmetic(
  id: number,
  patch: UpdateCosmeticInput
): Promise<CosmeticRow | null> {
  const current = await getCosmeticById(id);
  if (!current) return null;

  const next = {
    name: patch.name ?? current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    image_url: patch.imageUrl !== undefined ? patch.imageUrl : current.image_url,
    color_value: patch.colorValue !== undefined ? patch.colorValue : current.color_value,
    font_family: patch.fontFamily !== undefined ? patch.fontFamily : current.font_family,
    rarity: patch.rarity ?? current.rarity,
  };

  const { rows } = await pool.query<CosmeticRow>(
    `UPDATE cosmetics SET name = $1, description = $2, image_url = $3, color_value = $4, font_family = $5, rarity = $6
     WHERE id = $7
     RETURNING *`,
    [next.name, next.description, next.image_url, next.color_value, next.font_family, next.rarity, id]
  );
  return rows[0] ?? null;
}

/**
 * Supprime un cosmétique — refuse s'il est le défaut de son emplacement
 * (toujours nécessaire comme repli), déjà possédé par au moins un joueur, ou
 * référencé par une récompense de caisse gambling (même règle que
 * removeReward/removeCrate — préserve l'historique).
 */
export async function removeCosmetic(id: number): Promise<void> {
  const cosmetic = await getCosmeticById(id);
  if (!cosmetic) return;

  if (cosmetic.is_default) {
    throw Object.assign(
      new Error('Ce cosmétique est le défaut de son emplacement, il ne peut pas être supprimé'),
      { status: 409 }
    );
  }

  const { rows: ownedRows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM user_cosmetics WHERE cosmetic_id = $1',
    [id]
  );
  if (Number(ownedRows[0]?.count ?? 0) > 0) {
    throw Object.assign(
      new Error('Ce cosmétique est déjà possédé par au moins un joueur, il ne peut plus être supprimé'),
      { status: 409 }
    );
  }

  const { rows: rewardRows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM gambling_crate_rewards WHERE cosmetic_id = $1',
    [id]
  );
  if (Number(rewardRows[0]?.count ?? 0) > 0) {
    throw Object.assign(
      new Error('Ce cosmétique est utilisé comme récompense de caisse, retire-le de la caisse d\'abord'),
      { status: 409 }
    );
  }

  await pool.query('DELETE FROM cosmetics WHERE id = $1', [id]);
}
