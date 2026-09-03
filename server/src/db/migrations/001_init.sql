-- Points Sourires — schema initial

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'player',
  sp_balance INT NOT NULL DEFAULT 0,
  sp_total_earned INT NOT NULL DEFAULT 0,
  login_streak INT NOT NULL DEFAULT 0,
  last_login_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sp_balance_non_negative CHECK (sp_balance >= 0),
  CONSTRAINT role_valid CHECK (role IN ('player', 'admin'))
);

CREATE TABLE seasons (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT season_status_valid CHECK (status IN ('active', 'closed'))
);

CREATE TABLE season_snapshots (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  user_id INT REFERENCES users(id),
  final_balance INT NOT NULL,
  final_total_earned INT NOT NULL,
  rank INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sp_transactions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  season_id INT REFERENCES seasons(id),
  amount INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  related_id INT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sp_transaction_type_valid CHECK (type IN (
    'login_bonus', 'challenge_win', 'challenge_loss',
    'minigame_reward', 'admin_grant', 'admin_deduct'
  ))
);

CREATE TABLE challenges (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  challenger_id INT REFERENCES users(id),
  challenged_id INT REFERENCES users(id),
  wager_amount INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  winner_id INT REFERENCES users(id),
  result_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT challenge_status_valid CHECK (status IN (
    'pending', 'accepted', 'declined', 'expired', 'resolved'
  ))
);

CREATE TABLE minigame_sessions (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  game_type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(20) DEFAULT 'open',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT minigame_status_valid CHECK (status IN ('open', 'closed'))
);

CREATE TABLE minigame_participants (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES minigame_sessions(id),
  user_id INT REFERENCES users(id),
  rank INT,
  sp_awarded INT DEFAULT 0,
  awarded_by INT REFERENCES users(id),
  awarded_at TIMESTAMPTZ
);

CREATE TABLE admin_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sp_transactions_user ON sp_transactions(user_id);
CREATE INDEX idx_sp_transactions_season ON sp_transactions(season_id);
CREATE INDEX idx_challenges_challenger ON challenges(challenger_id);
CREATE INDEX idx_challenges_challenged ON challenges(challenged_id);
CREATE INDEX idx_minigame_participants_session ON minigame_participants(session_id);
