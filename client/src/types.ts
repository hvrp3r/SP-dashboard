export type UserRole = 'player' | 'admin';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  sp_balance: number;
  sp_total_earned: number;
  login_streak: number;
  last_login_date: string | null;
  created_at: string;
  is_leaderboard_hidden: boolean;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export type SeasonStatus = 'active' | 'closed';

export interface Season {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string | null;
  status: SeasonStatus;
  created_by: number | null;
  created_at: string;
}

export interface SeasonSnapshotEntry {
  id: number;
  season_id: number;
  user_id: number;
  final_balance: number;
  final_total_earned: number;
  rank: number;
  created_at: string;
  username: string;
  avatar_url: string | null;
}

export interface SeasonSnapshotResponse {
  season: Season;
  snapshot: SeasonSnapshotEntry[];
}

export type LeaderboardSort = 'sp_balance' | 'sp_total_earned';

export interface LeaderboardEntry {
  id: number;
  username: string;
  avatar_url: string | null;
  role: UserRole;
  sp_balance: number;
  sp_total_earned: number;
  login_streak: number;
}

export type SpTransactionType =
  | 'login_bonus'
  | 'challenge_win'
  | 'challenge_loss'
  | 'minigame_reward'
  | 'admin_grant'
  | 'admin_deduct';

export interface SpTransaction {
  id: number;
  user_id: number;
  season_id: number | null;
  amount: number;
  type: SpTransactionType;
  related_id: number | null;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
}

export interface SpTransactionEntry extends SpTransaction {
  username: string;
}

export interface AdminConfigEntry {
  key: string;
  value: string;
  description: string | null;
  updated_by: number | null;
  updated_at: string;
}

export type ChallengeStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'resolved'
  | 'cancelled';

export type ChallengeParticipantStatus = 'pending' | 'accepted' | 'declined';

export interface ChallengeParticipant {
  id: number;
  challenge_id: number;
  user_id: number;
  is_challenger: boolean;
  status: ChallengeParticipantStatus;
  reported_winner_id: number | null;
  responded_at: string | null;
  created_at: string;
  username: string;
}

export interface Challenge {
  id: number;
  season_id: number | null;
  challenger_id: number;
  wager_amount: number;
  description: string | null;
  status: ChallengeStatus;
  winner_id: number | null;
  result_note: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  participants: ChallengeParticipant[];
  resolutionError?: string;
}

export type MinigameStatus = 'open' | 'closed';

export const MINIGAME_GAME_TYPES = ['quiz'] as const;
export type MinigameGameType = (typeof MINIGAME_GAME_TYPES)[number];

export interface MinigameSession {
  id: number;
  season_id: number | null;
  game_type: string;
  title: string | null;
  description: string | null;
  status: MinigameStatus;
  created_by: number | null;
  created_at: string;
  closed_at: string | null;
}

export interface MinigameParticipant {
  id: number;
  session_id: number;
  user_id: number;
  sp_awarded: number;
  awarded_by: number | null;
  awarded_at: string | null;
  joined_at: string;
  username: string;
}

export type MinigameQuestionStatus = 'active' | 'closed';

export interface MinigameAnswerView {
  user_id: number;
  username: string;
  submitted_at: string;
  seconds_to_answer: number;
  answer_text?: string;
}

export interface MinigameQuestionView {
  id: number;
  session_id: number;
  prompt: string;
  status: MinigameQuestionStatus;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  answers: MinigameAnswerView[];
}

export interface MinigameSessionDetail extends MinigameSession {
  participants: MinigameParticipant[];
  currentQuestion: MinigameQuestionView | null;
}

export type NotificationType =
  | 'challenge_received'
  | 'challenge_accepted'
  | 'challenge_declined'
  | 'challenge_resolved'
  | 'challenge_cancelled'
  | 'challenge_expired'
  | 'minigame_open'
  | 'sp_gained'
  | 'sp_lost';

export interface AppNotification {
  id: number;
  user_id: number;
  type: NotificationType;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface PlayerStats {
  rank: number | null;
  challenges: { wins: number; losses: number };
  transactionTotals: Partial<Record<SpTransactionType, { total: number; count: number }>>;
}
