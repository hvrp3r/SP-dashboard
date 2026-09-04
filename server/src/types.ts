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
  disabled_at: string | null;
  disabled_by: number | null;
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

export type AdminUserSummary = Pick<
  UserRow,
  | 'id'
  | 'username'
  | 'email'
  | 'avatar_url'
  | 'role'
  | 'sp_balance'
  | 'sp_total_earned'
  | 'login_streak'
  | 'created_at'
  | 'is_leaderboard_hidden'
  | 'disabled_at'
>;

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
  | 'gambling_win'
  | 'auction_bid_hold'
  | 'auction_bid_refund'
  | 'auction_sale';

export interface SpTransactionRow {
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
  | 'sp_lost'
  | 'cosmetic_earned'
  | 'auction_outbid'
  | 'auction_won'
  | 'auction_sold'
  | 'auction_expired'
  | 'auction_cancelled';

export type CosmeticSlot = 'avatar_frame' | 'banner' | 'name_color' | 'title' | 'name_font';
export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
/** Comment un joueur a obtenu un cosmétique — miroir de sp_transactions.type mais scoping propre à ce système. */
export type CosmeticObtainedSource = 'gambling' | 'admin_grant' | 'auction';

export interface CosmeticRow {
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

export interface UserCosmeticRow {
  id: number;
  user_id: number;
  cosmetic_id: number;
  slot: CosmeticSlot;
  equipped: boolean;
  quantity: number;
  obtained_source: CosmeticObtainedSource;
  obtained_at: string;
}

export interface UserCosmeticEntry extends UserCosmeticRow {
  cosmetic: CosmeticRow;
}

/** Vue publique légère — ce qu'un autre joueur voit affiché (Leaderboard, Profil). */
export interface EquippedCosmetic {
  slot: CosmeticSlot;
  key: string;
  name: string;
  image_url: string | null;
  color_value: string | null;
  font_family: string | null;
}

export type AuctionStatus = 'active' | 'sold' | 'expired' | 'cancelled';
export type AuctionBidStatus = 'active' | 'refunded' | 'won';

export interface CosmeticAuctionRow {
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

export interface CosmeticAuctionEntry extends CosmeticAuctionRow {
  cosmetic: CosmeticRow;
  seller_username: string;
  current_bidder_username: string | null;
  bid_count: number;
}

export interface AuctionBidRow {
  id: number;
  auction_id: number;
  bidder_id: number;
  amount: number;
  status: AuctionBidStatus;
  created_at: string;
  hold_transaction_id: number | null;
  refund_transaction_id: number | null;
}

export interface AuctionBidEntry extends AuctionBidRow {
  bidder_username: string;
}

export interface CosmeticAuctionDetail extends CosmeticAuctionEntry {
  bids: AuctionBidEntry[];
}

export type GamblingRewardType = 'sp' | 'custom' | 'cosmetic';

export interface GamblingCrateRow {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  cost_sp: number;
  max_opens_per_player: number | null;
  /** NULL = limite à vie (comportement historique) ; sinon nb de jours entre deux resets de max_opens_per_player. */
  reset_interval_days: number | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  /** Ouverture conditionnée à un abonnement Ko-fi actif plutôt qu'à un coût SP (voir subscription.service.ts). */
  requires_subscription: boolean;
}

export interface GamblingCrateRewardRow {
  id: number;
  crate_id: number;
  type: GamblingRewardType;
  title: string;
  image_url: string | null;
  sp_amount: number | null;
  cosmetic_id: number | null;
  /** Filtre "pool" (cosmetic_id NULL) : catégorie et/ou rareté à tirer au hasard à l'ouverture. */
  cosmetic_slot_filter: CosmeticSlot | null;
  cosmetic_rarity_filter: CosmeticRarity | null;
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
  subscriptionActive: boolean;
}

export type SubscriptionStatus = 'inactive' | 'active';

export interface SubscriptionRow {
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
}

export interface SubscriptionEntry extends SubscriptionRow {
  username: string;
  avatar_url: string | null;
}

export interface KofiEventRow {
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
  raw_payload: unknown;
  received_at: string;
}

export interface KofiWebhookPayload {
  verification_token: string;
  message_id: string;
  timestamp: string;
  type: string;
  is_public: boolean;
  from_name: string;
  message: string | null;
  amount: string;
  url: string;
  email: string;
  currency: string;
  is_subscription_payment: boolean;
  is_first_subscription_payment: boolean;
  kofi_transaction_id: string;
  tier_name: string | null;
}

export type GamblingGameId = 'crates' | 'blackjack';

export interface GamblingGameInfo {
  id: GamblingGameId;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  /** Taux de redistribution en %, annoncé aux joueurs. Null si non calculable (ex: aucune caisse payante configurée). */
  rtp: number | null;
}

export type BlackjackSessionStatus = 'waiting' | 'active' | 'finished';
export type BlackjackHandStatus = 'playing' | 'stood' | 'busted';
export type BlackjackOutcome = 'win' | 'blackjack' | 'push' | 'lose';

export interface BlackjackCard {
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
  suit: 'S' | 'H' | 'D' | 'C';
}

export interface BlackjackSessionRow {
  id: number;
  season_id: number | null;
  status: BlackjackSessionStatus;
  starts_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  dealer_cards: BlackjackCard[];
  dealer_hole_revealed: boolean;
  current_hand_id: number | null;
  created_at: string;
}

export interface BlackjackHandRow {
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
}

export interface BlackjackHandEntry extends BlackjackHandRow {
  username: string;
  avatar_url: string | null;
}

export interface BlackjackSessionPublicView extends Omit<BlackjackSessionRow, 'dealer_cards'> {
  dealer_cards: (BlackjackCard | null)[];
  hands: BlackjackHandEntry[];
}

export interface BlackjackActionResult {
  session: BlackjackSessionPublicView;
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

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}
