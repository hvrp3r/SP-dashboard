import { apiClient } from './client.js';
import type { KofiEvent, Subscription, SubscriptionAdminEntry } from '../types.js';

export const getMine = () => apiClient.get<Subscription>('/api/subscriptions/me');

export const adminListAll = () =>
  apiClient.get<SubscriptionAdminEntry[]>('/api/subscriptions/admin');

export const adminListUnmatched = () =>
  apiClient.get<KofiEvent[]>('/api/subscriptions/admin/unmatched');

export const adminMatchUnmatched = (eventId: number, userId: number) =>
  apiClient.post<Subscription>(`/api/subscriptions/admin/unmatched/${eventId}/match`, { userId });

export const adminSetStatus = (
  userId: number,
  input: { status: 'active' | 'inactive'; currentPeriodEnd?: string | null }
) => apiClient.put<Subscription>(`/api/subscriptions/admin/${userId}`, input);
