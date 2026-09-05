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

export interface AdminUserSummary {
  id: number;
  username: string;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  sp_balance: number;
  sp_total_earned: number;
  login_streak: number;
  created_at: string;
  is_leaderboard_hidden: boolean;
  disabled_at: string | null;
}

export interface DailyBonusClaimResult {
  profile: User;
  alreadyClaimed: boolean;
  amount: number;
  streak: number;
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

export type CosmeticSlot = 'avatar_frame' | 'banner' | 'name_color' | 'title' | 'name_font';
export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type CosmeticObtainedSource = 'gambling' | 'admin_grant' | 'auction';

export interface Cosmetic {
  id: number;
  slot: CosmeticSlot;
  key: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color_value: string | null;
  font_family: string | null;
  rarity: CosmeticRarity;
  is_default: boolean;
  created_by: number | null;
  created_at: string;
}

export interface UserCosmeticEntry {
  id: number;
  user_id: number;
  cosmetic_id: number;
  slot: CosmeticSlot;
  equipped: boolean;
  quantity: number;
  obtained_source: CosmeticObtainedSource;
  obtained_at: string;
  cosmetic: Cosmetic;
}

export interface EquippedCosmetic {
  slot: CosmeticSlot;
  key: string;
  name: string;
  image_url: string | null;
  color_value: string | null;
  font_family: string | null;
}

export interface MyCosmetics {
  owned: UserCosmeticEntry[];
  equipped: EquippedCosmetic[];
}

export interface LeaderboardEntry {
  id: number;
  username: string;
  avatar_url: string | null;
  role: UserRole;
  sp_balance: number;
  sp_total_earned: number;
  login_streak: number;
  equipped_cosmetics: EquippedCosmetic[];
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

export interface SpTransaction {
  id: number;
  user_id: number;
  season_id: number | null;
  amount: number;
  type: SpTransactionType;
  related_id: number | null;
  note: string | null;
  created_at: string;
  affects_total_earned: boolean;
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

export interface ChallengeQuota {
  maxPerDay: number;
  countToday: number;
}

export type MinigameStatus = 'open' | 'closed' | 'cancelled';

export const MINIGAME_GAME_TYPES = ['quiz', 'flappy_bird'] as const;
export type MinigameGameType = (typeof MINIGAME_GAME_TYPES)[number];

export interface MinigameSession {
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
  ends_at: string | null;
  reward_1st: number | null;
  reward_2nd: number | null;
  reward_3rd: number | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
}

export interface FlappyBirdAttempt {
  id: number;
  session_id: number;
  user_id: number;
  score: number;
  played_at: string;
  excluded_at: string | null;
  excluded_by: number | null;
  username: string;
}

export interface FlappyBirdLeaderboardEntry {
  user_id: number;
  username: string;
  avatar_url: string | null;
  best_score: number;
  achieved_at: string;
  equipped_cosmetics: EquippedCosmetic[];
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
  // Branche quiz
  participants?: MinigameParticipant[];
  currentQuestion?: MinigameQuestionView | null;
  // Branche flappy_bird
  leaderboard?: FlappyBirdLeaderboardEntry[];
  myBest?: FlappyBirdLeaderboardEntry | null;
  attempts?: FlappyBirdAttempt[];
}

export type NotificationType =
  | 'challenge_received'
  | 'challenge_accepted'
  | 'challenge_declined'
  | 'challenge_resolved'
  | 'challenge_cancelled'
  | 'challenge_expired'
  | 'minigame_open'
  | 'cosmetic_earned'
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

export type GamblingRewardType = 'sp' | 'custom' | 'cosmetic';

export interface GamblingCrate {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  cost_sp: number;
  max_opens_per_player: number | null;
  reset_interval_days: number | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  requires_subscription: boolean;
}

export interface GamblingCrateReward {
  id: number;
  crate_id: number;
  type: GamblingRewardType;
  title: string;
  image_url: string | null;
  sp_amount: number | null;
  cosmetic_id: number | null;
  cosmetic_slot_filter: CosmeticSlot | null;
  cosmetic_rarity_filter: CosmeticRarity | null;
  weight: number;
  created_at: string;
}

export interface GamblingCrateRewardView extends GamblingCrateReward {
  weight_percent: number;
}

export interface GamblingCrateEntry extends GamblingCrate {
  myOpenCount: number;
}

export interface GamblingCrateDetail extends GamblingCrateEntry {
  rewards: GamblingCrateRewardView[];
}

export interface GamblingOpenResult {
  reward: GamblingCrateReward;
  cosmetic: Cosmetic | null;
  balance: number;
  spentToday: number;
  maxWagerPerDay: number;
}

export type AuctionStatus = 'active' | 'sold' | 'expired' | 'cancelled';
export type AuctionBidStatus = 'active' | 'refunded' | 'won';

export interface Auction {
  id: number;
  seller_id: number;
  cosmetic_id: number;
  starting_price: number;
  current_bid: number | null;
  current_bidder_id: number | null;
  status: AuctionStatus;
  created_at: string;
  ends_at: string;
  resolved_at: string | null;
  cancelled_by: number | null;
  cancelled_at: string | null;
}

export interface AuctionEntry extends Auction {
  cosmetic: Cosmetic;
  seller_username: string;
  current_bidder_username: string | null;
  bid_count: number;
}

export interface AuctionBid {
  id: number;
  auction_id: number;
  bidder_id: number;
  amount: number;
  status: AuctionBidStatus;
  created_at: string;
  hold_transaction_id: number | null;
  refund_transaction_id: number | null;
  bidder_username: string;
}

export interface AuctionDetail extends AuctionEntry {
  bids: AuctionBid[];
}

export interface GamblingStatus {
  enabled: boolean;
  maxWagerPerDay: number;
  spentToday: number;
  subscriptionActive: boolean;
}

export type SubscriptionStatus = 'inactive' | 'active';

export interface Subscription {
  id: number;
  user_id: number;
  status: SubscriptionStatus;
  link_code: string;
  kofi_email: string | null;
  current_period_end: string | null;
  last_payment_at: string | null;
  activated_by: number | null;
  created_at: string;
  updated_at: string;
  isActive: boolean;
}

export interface SubscriptionAdminEntry {
  id: number;
  user_id: number;
  status: SubscriptionStatus;
  link_code: string;
  kofi_email: string | null;
  current_period_end: string | null;
  last_payment_at: string | null;
  activated_by: number | null;
  created_at: string;
  updated_at: string;
  username: string;
  avatar_url: string | null;
}

export interface KofiEvent {
  id: number;
  kofi_transaction_id: string;
  message_id: string;
  type: string;
  is_subscription_payment: boolean;
  is_first_subscription_payment: boolean;
  from_name: string | null;
  email: string | null;
  amount: string | null;
  currency: string | null;
  message: string | null;
  tier_name: string | null;
  kofi_timestamp: string;
  matched_user_id: number | null;
  received_at: string;
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

export interface GamblingOpenEntry {
  id: number;
  user_id: number;
  crate_id: number;
  reward_id: number;
  season_id: number | null;
  sp_transaction_id: number | null;
  opened_at: string;
  crate_name: string;
  reward_title: string;
  reward_type: GamblingRewardType;
  reward_image_url: string | null;
  sp_amount: number | null;
}

export type BlackjackSessionStatus = 'waiting' | 'active' | 'finished';
export type BlackjackHandStatus = 'playing' | 'stood' | 'busted';
export type BlackjackOutcome = 'win' | 'blackjack' | 'push' | 'lose';

export interface BlackjackCard {
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
  suit: 'S' | 'H' | 'D' | 'C';
}

export interface BlackjackHand {
  id: number;
  session_id: number;
  user_id: number;
  bet_amount: number;
  cards: BlackjackCard[];
  status: BlackjackHandStatus;
  outcome: BlackjackOutcome | null;
  bet_transaction_id: number | null;
  payout_transaction_id: number | null;
  action_deadline: string | null;
  joined_at: string;
  resolved_at: string | null;
  username: string;
  avatar_url: string | null;
}

export interface BlackjackSession {
  id: number;
  season_id: number | null;
  status: BlackjackSessionStatus;
  starts_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  dealer_cards: (BlackjackCard | null)[];
  dealer_hole_revealed: boolean;
  current_hand_id: number | null;
  created_at: string;
  hands: BlackjackHand[];
}

export interface BlackjackActionResult {
  session: BlackjackSession;
  balance: number;
  enabled: boolean;
}

export interface BlackjackHistoryEntry {
  id: number;
  session_id: number;
  bet_amount: number;
  cards: BlackjackCard[];
  status: BlackjackHandStatus;
  outcome: BlackjackOutcome;
  resolved_at: string;
  dealer_cards: BlackjackCard[];
}

export type GamblingGameId = 'crates' | 'blackjack';

export interface GamblingGameInfo {
  id: GamblingGameId;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  rtp: number | null;
}

export interface PlayerStats {
  rank: number | null;
  challenges: { wins: number; losses: number };
  transactionTotals: Partial<Record<SpTransactionType, { total: number; count: number }>>;
}
