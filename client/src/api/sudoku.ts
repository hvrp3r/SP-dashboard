import { apiClient } from './client.js';
import type {
  SudokuAttemptHistoryEntry,
  SudokuCheckResult,
  SudokuDifficulty,
  SudokuGameView,
  SudokuTodayAdminEntry,
  SudokuTodayView,
} from '../types.js';

export const getToday = () => apiClient.get<SudokuTodayView>('/api/sudoku/today');

export const chooseDifficulty = (difficulty: SudokuDifficulty) =>
  apiClient.post<SudokuGameView>('/api/sudoku/choose', { difficulty });

export const checkGrid = (grid: string) => apiClient.post<SudokuCheckResult>('/api/sudoku/check', { grid });

export const getTodayAdmin = () => apiClient.get<SudokuTodayAdminEntry[]>('/api/sudoku/today/admin');

export const listAttempts = (limit?: number) =>
  apiClient.get<SudokuAttemptHistoryEntry[]>(`/api/sudoku/attempts${limit ? `?limit=${limit}` : ''}`);
