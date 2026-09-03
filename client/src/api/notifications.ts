import { apiClient } from './client.js';
import type { AppNotification } from '../types.js';

export const listNotifications = (limit = 20) =>
  apiClient.get<AppNotification[]>(`/api/notifications?limit=${limit}`);

export const getUnreadCount = () =>
  apiClient.get<{ count: number }>('/api/notifications/unread-count');

export const markRead = (id: number) =>
  apiClient.post<void>(`/api/notifications/${id}/read`);

export const markAllRead = () => apiClient.post<void>('/api/notifications/read-all');
