import { apiClient } from './client.js';
import type { Cosmetic, CosmeticRarity, CosmeticSlot, EquippedCosmetic, MyCosmetics } from '../types.js';

export const getCatalog = () => apiClient.get<Cosmetic[]>('/api/cosmetics/catalog');

export const getRarityWeights = () =>
  apiClient.get<Record<CosmeticRarity, number>>('/api/cosmetics/rarity-weights');

export const getMine = () => apiClient.get<MyCosmetics>('/api/cosmetics/me');

export const getForUser = (userId: number) =>
  apiClient.get<EquippedCosmetic[]>(`/api/cosmetics/user/${userId}`);

export const equip = (cosmeticId: number) =>
  apiClient.post<EquippedCosmetic[]>('/api/cosmetics/equip', { cosmeticId });

export const unequip = (slot: CosmeticSlot) =>
  apiClient.post<EquippedCosmetic[]>('/api/cosmetics/equip', { cosmeticId: null, slot });

export const createCosmetic = (input: {
  slot: CosmeticSlot;
  key: string;
  name: string;
  description?: string;
  imageUrl?: string;
  colorValue?: string;
  fontFamily?: string;
  rarity?: CosmeticRarity;
}) => apiClient.post<Cosmetic>('/api/cosmetics', input);

export const updateCosmetic = (
  id: number,
  patch: Partial<{
    name: string;
    description: string | null;
    imageUrl: string | null;
    colorValue: string | null;
    fontFamily: string | null;
    rarity: CosmeticRarity;
  }>
) => apiClient.put<Cosmetic>(`/api/cosmetics/${id}`, patch);

export const removeCosmetic = (id: number) => apiClient.delete<void>(`/api/cosmetics/${id}`);

export const grant = (userId: number, cosmeticId: number) =>
  apiClient.post<{ ok: true }>('/api/cosmetics/grant', { userId, cosmeticId });
