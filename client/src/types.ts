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
  equipped_cosmetics: EquippedCosmetic[];
}

export interface SeasonSnapshotResponse {
  season: Season;
  snapshot: SeasonSnapshotEntry[];
}

export type LeaderboardSort = 'sp_balance' | 'sp_total_earned';

export type CosmeticSlot = 'avatar_frame' | 'banner' | 'name_color' | 'title' | 'name_font';
export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
/** Effet visuel animé appliqué par-dessus color_value (name_color/title uniquement) — voir index.css. 'shimmer' est restreint à name_color (voir cosmeticsLabels.ts). */
export type CosmeticColorAnimation =
  | 'rainbow'
  | 'pulse'
  | 'neon'
  | 'fire'
  | 'ice'
  | 'disco'
  | 'glitch'
  | 'lightning'
  | 'shimmer';
export type CosmeticObtainedSource = 'gambling' | 'admin_grant' | 'auction';

export interface Cosmetic {
  id: number;
  slot: CosmeticSlot;
  key: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color_value: string | null;
  color_animation: CosmeticColorAnimation | null;
  /** Accent d'une animation à deux couleurs (glitch/lightning/shimmer — voir cosmeticsLabels.ts). Nul = repli CSS par défaut. */
  color_secondary: string | null;
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
  color_animation: CosmeticColorAnimation | null;
  color_secondary: string | null;
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
  | 'gambling_win'
  | 'gambling_refund'
  | 'auction_bid_hold'
  | 'auction_bid_refund'
  | 'auction_sale'
  | 'motus_reward'
  | 'sudoku_reward';

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

export const CHALLENGE_TYPES = ['custom', 'coin_flip'] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

export type CoinSide = 'pile' | 'face';

export type ChallengeParticipantStatus = 'pending' | 'accepted' | 'declined';

export interface ChallengeParticipant {
  id: number;
  challenge_id: number;
  user_id: number;
  is_challenger: boolean;
  status: ChallengeParticipantStatus;
  reported_winner_id: number | null;
  coin_side: CoinSide | null;
  responded_at: string | null;
  created_at: string;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export interface Challenge {
  id: number;
  season_id: number | null;
  challenger_id: number;
  wager_amount: number;
  description: string | null;
  type: ChallengeType;
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
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export type MinigameQuestionStatus = 'active' | 'closed';

export interface MinigameAnswerView {
  user_id: number;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
  submitted_at: string;
  seconds_to_answer: number;
  answer_text?: string;
  // Verdict manuel du MSP, prioritaire sur le rapprochement automatique texte
  // ↔ correct_answer. Même masquage que answer_text tant que non révélé.
  marked_correct?: boolean | null;
}

export interface MinigameQuestionView {
  id: number;
  session_id: number;
  prompt: string;
  status: MinigameQuestionStatus;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  duration_seconds: number | null;
  ends_at: string | null;
  // Déclenché manuellement par le MSP pour passer la musique de tension en
  // phase intense avant le seuil automatique du décompte. Toujours visible.
  intense_at: string | null;
  // Masquée (absente) tant que la question n'est pas révélée pour un joueur
  // non-admin ; `null` reste possible si le MSP n'a saisi aucune réponse.
  correct_answer?: string | null;
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
  | 'sp_lost'
  | 'suggestion_comment'
  | 'suggestion_closed';

export interface AppNotification {
  id: number;
  user_id: number;
  type: NotificationType;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export type SuggestionType = 'feature' | 'bug';
export type SuggestionStatus = 'open' | 'closed';
export type SuggestionSort = 'top' | 'new';
export type SuggestionVoteValue = 1 | -1;

export interface Suggestion {
  id: number;
  author_id: number | null;
  author_username: string | null;
  author_avatar_url: string | null;
  author_equipped_cosmetics: EquippedCosmetic[];
  type: SuggestionType;
  title: string;
  description: string | null;
  status: SuggestionStatus;
  closed_at: string | null;
  closed_by: number | null;
  created_at: string;
  vote_count: number;
  comment_count: number;
  /** 1 = upvoté, -1 = downvoté, 0 = pas de vote du viewer courant. */
  user_vote: SuggestionVoteValue | 0;
}

export interface SuggestionComment {
  id: number;
  suggestion_id: number;
  author_id: number | null;
  author_username: string | null;
  author_avatar_url: string | null;
  author_equipped_cosmetics: EquippedCosmetic[];
  body: string;
  created_at: string;
}

export interface SuggestionDetail extends Suggestion {
  comments: SuggestionComment[];
}

export type ProfileReactionValue = 1 | -1;

export interface ProfileReactionSummary {
  likeCount: number;
  dislikeCount: number;
  /** 1 = liké, -1 = disliké, 0 = pas de réaction du viewer courant. */
  userReaction: ProfileReactionValue | 0;
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
  seller_equipped_cosmetics: EquippedCosmetic[];
  current_bidder_username: string | null;
  current_bidder_equipped_cosmetics: EquippedCosmetic[];
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
  bidder_equipped_cosmetics: EquippedCosmetic[];
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
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
  crate_name: string;
  reward_title: string;
  reward_type: GamblingRewardType;
  reward_image_url: string | null;
  sp_amount: number | null;
}

export type GamblingBattleStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled';

export interface GamblingBattle {
  id: number;
  season_id: number | null;
  created_by: number;
  max_players: number;
  status: GamblingBattleStatus;
  cost_sp: number;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  created_at: string;
}

export interface GamblingBattleCrateEntry {
  id: number;
  battle_id: number;
  crate_id: number;
  position: number;
  crate_name: string;
  crate_image_url: string | null;
  crate_cost_sp: number;
}

export interface GamblingBattleParticipantEntry {
  id: number;
  battle_id: number;
  user_id: number;
  is_creator: boolean;
  entry_transaction_id: number | null;
  joined_at: string;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
  revealed_sp_total: number;
}

export interface GamblingBattleOpenEntry {
  participant_id: number;
  position: number;
  reward_id: number;
  reward_title: string;
  reward_type: GamblingRewardType;
  reward_image_url: string | null;
  sp_amount: number | null;
  resolved_cosmetic: Cosmetic | null;
}

export interface GamblingBattleWinnerEntry {
  id: number;
  battle_id: number;
  user_id: number;
  share_amount: number;
  payout_transaction_id: number | null;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export interface GamblingBattlePublicView extends GamblingBattle {
  crates: GamblingBattleCrateEntry[];
  participants: GamblingBattleParticipantEntry[];
  opens: GamblingBattleOpenEntry[];
  revealedCount: number;
  stepDurationMs: number;
  winners: GamblingBattleWinnerEntry[];
}

export interface GamblingBattleActionResult {
  battle: GamblingBattlePublicView;
  balance: number;
  enabled: boolean;
}

export interface GamblingBattleListEntry extends GamblingBattle {
  crates: GamblingBattleCrateEntry[];
  participantCount: number;
  winners: GamblingBattleWinnerEntry[];
}

export type GamblingSpectatorRoom = 'crates' | 'blackjack' | 'crash' | 'tower';

export interface GamblingSpectatorEntry {
  user_id: number;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export type ChatRoom = 'global' | 'crates' | 'blackjack' | 'crash' | 'tower' | 'minigame';

export interface ChatMessage {
  id: number;
  room: ChatRoom;
  room_key: string;
  user_id: number;
  body: string;
  created_at: string;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
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
  equipped_cosmetics: EquippedCosmetic[];
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
  user_id: number;
  bet_amount: number;
  cards: BlackjackCard[];
  status: BlackjackHandStatus;
  outcome: BlackjackOutcome;
  resolved_at: string;
  dealer_cards: BlackjackCard[];
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export type GamblingGameId = 'crates' | 'blackjack' | 'crash' | 'tower' | 'battles';

export interface GamblingGameInfo {
  id: GamblingGameId;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  rtp: number | null;
}

export type CrashRoundStatus = 'betting' | 'running' | 'crashed';

/** Multiplicateurs en entier × 100 (234 = 2.34x) — voir le commentaire en tête de 038_crash.sql côté serveur. */
export interface CrashBet {
  id: number;
  round_id: number;
  user_id: number;
  bet_amount: number;
  cashout_multiplier_x100: number | null;
  auto_cashout_multiplier_x100: number | null;
  bet_transaction_id: number | null;
  payout_transaction_id: number | null;
  joined_at: string;
  resolved_at: string | null;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export interface CrashRound {
  id: number;
  season_id: number | null;
  status: CrashRoundStatus;
  crash_point_x100: number | null;
  starts_at: string | null;
  started_at: string | null;
  crashed_at: string | null;
  created_at: string;
  bets: CrashBet[];
}

export interface CrashActionResult {
  round: CrashRound;
  balance: number;
  enabled: boolean;
}

export interface CrashHistoryEntry {
  id: number;
  round_id: number;
  user_id: number;
  bet_amount: number;
  cashout_multiplier_x100: number | null;
  resolved_at: string;
  crash_point_x100: number;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export type TowerDifficulty = 'easy' | 'medium' | 'hard';
export type TowerGameStatus = 'in_progress' | 'cashed_out' | 'busted';

/** Multiplicateurs entiers × 100 — même convention que crash_point_x100. */
export interface TowerGame {
  id: number;
  user_id: number;
  season_id: number | null;
  difficulty: TowerDifficulty;
  bet_amount: number;
  status: TowerGameStatus;
  current_level: number;
  /** Position(s) minée(s) par étage : `null` tant que l'étage n'a pas été franchi (ou la partie terminée). */
  mine_positions: (number[] | null)[];
  picks: number[];
  total_floors: number;
  cells_per_floor: number;
  mines_per_floor: number[];
  multipliers_x100: number[];
  current_multiplier_x100: number;
  next_multiplier_x100: number | null;
  payout: number | null;
  created_at: string;
  resolved_at: string | null;
}

export interface TowerActionResult {
  game: TowerGame | null;
  balance: number;
  enabled: boolean;
}

export interface TowerHistoryEntry {
  id: number;
  user_id: number;
  difficulty: TowerDifficulty;
  bet_amount: number;
  status: TowerGameStatus;
  current_level: number;
  total_floors: number;
  final_multiplier_x100: number;
  payout: number;
  resolved_at: string;
  username: string;
  avatar_url: string | null;
  equipped_cosmetics: EquippedCosmetic[];
}

export interface TowerDifficultyInfo {
  difficulty: TowerDifficulty;
  floors: number;
  cells_per_floor: number;
  mines_per_floor: number;
  multipliers_x100: number[];
}

export type MotusLetterState = 'correct' | 'present' | 'absent';

export interface MotusAttempt {
  id: number;
  daily_word_id: number;
  user_id: number;
  attempt_number: number;
  guess: string;
  result: MotusLetterState[];
  is_correct: boolean;
  created_at: string;
}

export type MotusGameStatus = 'in_progress' | 'won' | 'lost';

export interface MotusGame {
  wordDate: string;
  wordLength: number;
  maxAttempts: number;
  rewardSp: number;
  status: MotusGameStatus;
  attempts: MotusAttempt[];
  word: string | null;
}

export interface MotusQueueWord {
  id: number;
  word: string;
  added_by: number | null;
  position: number;
  used_at: string | null;
  created_at: string;
}

export type MotusWordSource = 'queue' | 'random' | 'manual';

export interface MotusHistoryEntry {
  id: number;
  word_date: string;
  word: string;
  queue_id: number | null;
  season_id: number | null;
  source: MotusWordSource;
  created_at: string;
}

/** Vue MSP du mot du jour, indépendante de la partie de l'admin (jamais masquée) — sert l'édition. */
export interface MotusTodayAdminView {
  wordDate: string;
  word: string;
  source: MotusWordSource;
  attemptCount: number;
}

/** Vue MSP : une soumission d'un joueur, tous jours confondus. */
export interface MotusAttemptHistoryEntry extends MotusAttempt {
  username: string;
  word_date: string;
  word: string;
}

export type SudokuDifficulty = 'easy' | 'medium' | 'hard';

export type SudokuGameStatus = 'in_progress' | 'won' | 'lost';

/** Vue tant qu'aucune difficulté n'a encore été choisie aujourd'hui — aucune grille n'est révélée. */
export interface SudokuChoosingView {
  status: 'choosing';
  rewards: Record<SudokuDifficulty, number>;
  maxAttempts: Record<SudokuDifficulty, number>;
}

/** Une tentative passée du joueur — pas de détail cellule par cellule ici (déjà vu au moment du check), juste de quoi tracer l'historique. */
export interface SudokuAttemptSummary {
  attemptNumber: number;
  isCorrect: boolean;
  createdAt: string;
  guess: string;
  cellCorrect: boolean[];
}

/** Vue publique du puzzle du jour une fois la difficulté choisie : la solution n'est incluse qu'en fin de partie. */
export interface SudokuGameView {
  status: SudokuGameStatus;
  puzzleDate: string;
  difficulty: SudokuDifficulty;
  givens: string;
  maxAttempts: number;
  attemptsUsed: number;
  attempts: SudokuAttemptSummary[];
  rewardSp: number;
  solution: string | null;
}

export type SudokuTodayView = SudokuChoosingView | SudokuGameView;

export interface SudokuCheckResult {
  solved: boolean;
  cellCorrect: boolean[];
  status: SudokuGameStatus;
  attemptsUsed: number;
  maxAttempts: number;
  attempts: SudokuAttemptSummary[];
  rewardSp: number;
  rewardGranted: boolean;
  solution: string | null;
}

/** Vue MSP en lecture seule : un puzzle par difficulté, rien à créer (génération automatique). */
export interface SudokuTodayAdminEntry {
  difficulty: SudokuDifficulty;
  puzzleDate: string;
  clues: number;
  completions: number;
}

/** Vue MSP : une soumission d'un joueur, tous jours et difficultés confondus. */
export interface SudokuAttemptHistoryEntry {
  id: number;
  user_id: number;
  username: string;
  puzzle_id: number;
  puzzle_date: string;
  difficulty: SudokuDifficulty;
  attempt_number: number;
  is_correct: boolean;
  created_at: string;
}

export interface PlayerStats {
  rank: number | null;
  challenges: { wins: number; losses: number };
  transactionTotals: Partial<Record<SpTransactionType, { total: number; count: number }>>;
}
