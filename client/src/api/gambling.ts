import { apiClient } from './client.js';
import type {
  GamblingCrate,
  GamblingCrateDetail,
  GamblingCrateEntry,
  GamblingCrateReward,
  GamblingGameInfo,
  GamblingInventoryEntry,
  GamblingOpenEntry,
  GamblingOpenResult,
  GamblingRewardType,
  GamblingStatus,
} from '../types.js';

export const listGames = () => apiClient.get<GamblingGameInfo[]>('/api/gambling/games');

export const listCrates = (includeInactive?: boolean) =>
  apiClient.get<GamblingCrateEntry[]>(
    `/api/gambling/crates${includeInactive ? '?includeInactive=true' : ''}`
  );

export const getCrate = (id: number) =>
  apiClient.get<GamblingCrateDetail>(`/api/gambling/crates/${id}`);

export const getStatus = () => apiClient.get<GamblingStatus>('/api/gambling/status');

export const getMyInventory = () =>
  apiClient.get<GamblingInventoryEntry[]>('/api/gambling/inventory/me');

export const getMyOpens = (limit?: number) =>
  apiClient.get<GamblingOpenEntry[]>(`/api/gambling/opens/me${limit ? `?limit=${limit}` : ''}`);

export const createCrate = (input: {
  name: string;
  description?: string;
  imageUrl?: string;
  costSp: number;
  maxOpensPerPlayer?: number | null;
}) => apiClient.post<GamblingCrate>('/api/gambling/crates', input);

export const updateCrate = (
  id: number,
  patch: Partial<{
    name: string;
    description: string | null;
    imageUrl: string | null;
    costSp: number;
    maxOpensPerPlayer: number | null;
    isActive: boolean;
  }>
) => apiClient.put<GamblingCrate>(`/api/gambling/crates/${id}`, patch);

export const removeCrate = (id: number) => apiClient.delete<void>(`/api/gambling/crates/${id}`);

export const openCrate = (crateId: number) =>
  apiClient.post<GamblingOpenResult>(`/api/gambling/crates/${crateId}/open`);

export const addReward = (
  crateId: number,
  input: {
    type: GamblingRewardType;
    title: string;
    imageUrl?: string;
    spAmount?: number;
    weight: number;
  }
) => apiClient.post<GamblingCrateReward>(`/api/gambling/crates/${crateId}/rewards`, input);

export const updateReward = (
  crateId: number,
  rewardId: number,
  patch: Partial<{ title: string; imageUrl: string | null; spAmount: number | null; weight: number }>
) =>
  apiClient.put<GamblingCrateReward>(
    `/api/gambling/crates/${crateId}/rewards/${rewardId}`,
    patch
  );

export const removeReward = (crateId: number, rewardId: number) =>
  apiClient.delete<void>(`/api/gambling/crates/${crateId}/rewards/${rewardId}`);
