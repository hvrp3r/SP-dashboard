import { apiClient } from './client.js';
import type {
  SudokuAttemptHistoryEntry,
  SudokuDifficulty,
  SudokuGameView,
  SudokuSubmitResult,
  SudokuTodayAdminEntry,
  SudokuTodayView,
} from '../types.js';

export const getToday = () => apiClient.get<SudokuTodayView>('/api/sudoku/today');

export const chooseDifficulty = (difficulty: SudokuDifficulty) =>
  apiClient.post<SudokuGameView>('/api/sudoku/choose', { difficulty });

export const submitCell = (cellIndex: number, digit: number) =>
  apiClient.post<SudokuSubmitResult>('/api/sudoku/submit', { cellIndex, digit: String(digit) });

export const getTodayAdmin = () => apiClient.get<SudokuTodayAdminEntry[]>('/api/sudoku/today/admin');

export const listAttempts = (limit?: number) =>
  apiClient.get<SudokuAttemptHistoryEntry[]>(`/api/sudoku/attempts${limit ? `?limit=${limit}` : ''}`);
