export type UserRole = 'player' | 'admin';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  avatar_url: string | null;
  role: UserRole;
  sp_balance: number;
  sp_total_earned: number;
  login_streak: number;
  last_login_date: string | null;
  created_at: string;
  is_leaderboard_hidden: boolean;
}

export type PublicUser = Pick<
  UserRow,
  | 'id'
  | 'username'
  | 'avatar_url'
  | 'role'
  | 'sp_balance'
  | 'sp_total_earned'
  | 'login_streak'
  | 'created_at'
  | 'is_leaderboard_hidden'
>;

export type PrivateUser = PublicUser & Pick<UserRow, 'email' | 'last_login_date'>;

export interface AccessTokenPayload {
  sub: number;
  username: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  sub: number;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: UserRole;
}

export type SeasonStatus = 'active' | 'closed';

export interface SeasonRow {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string | null;
  status: SeasonStatus;
  created_by: number | null;
  created_at: string;
}

export interface SeasonSnapshotRow {
  id: number;
  season_id: number;
  user_id: number;
  final_balance: number;
  final_total_earned: number;
  rank: number;
  created_at: string;
}

export interface SeasonSnapshotEntry extends SeasonSnapshotRow {
  username: string;
  avatar_url: string | null;
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
  | 'minigame_entry'
  | 'admin_grant'
  | 'admin_deduct'
  | 'gambling_spend'
  | 'gambling_win';

export interface SpTransactionRow {
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

export interface SpTransactionEntry extends SpTransactionRow {
  username: string;
}

export interface AdminConfigRow {
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

export interface ChallengeRow {
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
}

export type ChallengeParticipantStatus = 'pending' | 'accepted' | 'declined';

export interface ChallengeParticipantRow {
  id: number;
  challenge_id: number;
  user_id: number;
  is_challenger: boolean;
  status: ChallengeParticipantStatus;
  reported_winner_id: number | null;
  responded_at: string | null;
  created_at: string;
}

export interface ChallengeParticipantEntry extends ChallengeParticipantRow {
  username: string;
}

export interface ChallengeEntry extends ChallengeRow {
  participants: ChallengeParticipantEntry[];
}

export type MinigameStatus = 'open' | 'closed';

export const MINIGAME_GAME_TYPES = ['quiz'] as const;
export type MinigameGameType = (typeof MINIGAME_GAME_TYPES)[number];

export interface MinigameSessionRow {
  id: number;
  season_id: number | null;
  game_type: string;
  title: string | null;
  description: string | null;
  entry_fee: number | null;
  status: MinigameStatus;
  created_by: number | null;
  created_at: string;
  closed_at: string | null;
}

export interface MinigameParticipantRow {
  id: number;
  session_id: number;
  user_id: number;
  sp_awarded: number;
  awarded_by: number | null;
  awarded_at: string | null;
  joined_at: string;
}

export interface MinigameParticipantEntry extends MinigameParticipantRow {
  username: string;
}

export type MinigameQuestionStatus = 'active' | 'closed';

export interface MinigameQuestionRow {
  id: number;
  session_id: number;
  prompt: string;
  status: MinigameQuestionStatus;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
}

export interface MinigameAnswerRow {
  id: number;
  question_id: number;
  user_id: number;
  answer_text: string;
  submitted_at: string;
}

export interface MinigameAnswerView {
  user_id: number;
  username: string;
  submitted_at: string;
  seconds_to_answer: number;
  answer_text?: string;
}

export interface MinigameQuestionView extends MinigameQuestionRow {
  answers: MinigameAnswerView[];
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

export type GamblingRewardType = 'sp' | 'custom';

export interface GamblingCrateRow {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  cost_sp: number;
  max_opens_per_player: number | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
}

export interface GamblingCrateRewardRow {
  id: number;
  crate_id: number;
  type: GamblingRewardType;
  title: string;
  image_url: string | null;
  sp_amount: number | null;
  weight: number;
  created_at: string;
}

export interface GamblingCrateRewardView extends GamblingCrateRewardRow {
  weight_percent: number;
}

export interface GamblingCrateEntry extends GamblingCrateRow {
  myOpenCount: number;
}

export interface GamblingCrateDetail extends GamblingCrateEntry {
  rewards: GamblingCrateRewardView[];
}

export interface GamblingOpenRow {
  id: number;
  user_id: number;
  crate_id: number;
  reward_id: number;
  season_id: number | null;
  sp_transaction_id: number | null;
  opened_at: string;
}

export interface GamblingOpenEntry extends GamblingOpenRow {
  crate_name: string;
  reward_title: string;
  reward_type: GamblingRewardType;
  reward_image_url: string | null;
  sp_amount: number | null;
}

export interface GamblingInventoryEntry {
  id: number;
  user_id: number;
  reward_id: number;
  gambling_open_id: number;
  obtained_at: string;
  title: string;
  image_url: string | null;
}

export interface GamblingStatusInfo {
  enabled: boolean;
  maxWagerPerDay: number;
  spentToday: number;
}

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}
