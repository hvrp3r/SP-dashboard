import { apiClient } from './client.js';
import type { AuthResponse, User } from '../types.js';

export const register = (username: string, email: string, password: string) =>
  apiClient.post<AuthResponse>(
    '/api/auth/register',
    { username, email, password },
    { skipAuth: true }
  );

export const login = (email: string, password: string) =>
  apiClient.post<AuthResponse>('/api/auth/login', { email, password }, { skipAuth: true });

export const logout = () => apiClient.post<void>('/api/auth/logout', undefined, { skipAuth: true });

export const getMe = () => apiClient.get<User>('/api/users/me');
