import { apiClient } from './client.js';
import type { Auction, AuctionDetail, AuctionEntry } from '../types.js';

export const listActive = () => apiClient.get<AuctionEntry[]>('/api/auctions');

export const getById = (id: number) => apiClient.get<AuctionDetail>(`/api/auctions/${id}`);

export const getMyActivity = () =>
  apiClient.get<{ selling: AuctionEntry[]; bidding: AuctionEntry[] }>('/api/auctions/me');

export const create = (input: { cosmeticId: number; startingPrice: number; durationMinutes: number }) =>
  apiClient.post<Auction>('/api/auctions', input);

export const placeBid = (id: number, amount: number) =>
  apiClient.post<Auction>(`/api/auctions/${id}/bids`, { amount });

export const cancel = (id: number) => apiClient.delete<Auction>(`/api/auctions/${id}`);
