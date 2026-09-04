import { apiClient } from './client.js';
import type { SpTransaction, SpTransactionEntry, SpTransactionType } from '../types.js';

export const getMyTransactions = (limit = 20, offset = 0) =>
  apiClient.get<SpTransaction[]>(`/api/users/me/transactions?limit=${limit}&offset=${offset}`);

interface AllTransactionsFilter {
  type?: SpTransactionType;
  userId?: number;
  limit?: number;
  offset?: number;
}

export const getAllTransactions = ({
  type,
  userId,
  limit = 20,
  offset = 0,
}: AllTransactionsFilter = {}) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (type) params.set('type', type);
  if (userId) params.set('userId', String(userId));
  return apiClient.get<SpTransactionEntry[]>(`/api/transactions?${params.toString()}`);
};

export const revokeTransaction = (id: number) =>
  apiClient.post<SpTransactionEntry>(`/api/transactions/${id}/revoke`);

interface CreateTransactionInput {
  userId: number;
  type: 'admin_grant' | 'admin_deduct';
  amount: number;
  note?: string;
  affectsTotalEarned: boolean;
}

export const createTransaction = (input: CreateTransactionInput) =>
  apiClient.post<SpTransactionEntry>('/api/transactions', input);
