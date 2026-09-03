-- Section Gambling : case opening configurable par le MSP. Coût fixe par
-- caisse, pool de récompenses tiré au poids (SP classique ou gain cosmétique
-- sans valeur SP), plafond de mise quotidienne pour ne pas casser l'économie.

CREATE TABLE gambling_crates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT,
  cost_sp INT NOT NULL CHECK (cost_sp > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gambling_crate_rewards (
  id SERIAL PRIMARY KEY,
  crate_id INT REFERENCES gambling_crates(id),
  type VARCHAR(20) NOT NULL,
  title VARCHAR(255) NOT NULL,
  image_url TEXT,
  sp_amount INT,
  weight INT NOT NULL CHECK (weight > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT gambling_reward_type_valid CHECK (type IN ('sp', 'custom')),
  CONSTRAINT gambling_reward_sp_amount_consistent CHECK (
    (type = 'sp' AND sp_amount IS NOT NULL AND sp_amount > 0) OR
    (type = 'custom' AND sp_amount IS NULL)
  )
);

-- Historique de chaque ouverture (transparence/anti-triche).
CREATE TABLE gambling_opens (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  crate_id INT REFERENCES gambling_crates(id),
  reward_id INT REFERENCES gambling_crate_rewards(id),
  season_id INT REFERENCES seasons(id),
  sp_transaction_id INT REFERENCES sp_transactions(id),  -- NULL si le gain tiré était de type 'custom'
  opened_at TIMESTAMPTZ DEFAULT NOW()
);

-- Collection persistante des gains 'custom' obtenus (vitrine de profil).
-- Un item reste acquis à vie, ce n'est pas un consommable ; pas d'unicité,
-- le même gain peut être obtenu plusieurs fois.
CREATE TABLE gambling_inventory (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  reward_id INT REFERENCES gambling_crate_rewards(id),
  gambling_open_id INT REFERENCES gambling_opens(id),
  obtained_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gambling_crate_rewards_crate ON gambling_crate_rewards(crate_id);
CREATE INDEX idx_gambling_opens_user ON gambling_opens(user_id);
CREATE INDEX idx_gambling_opens_reward ON gambling_opens(reward_id);
CREATE INDEX idx_gambling_inventory_user ON gambling_inventory(user_id);

ALTER TABLE sp_transactions DROP CONSTRAINT sp_transaction_type_valid;
ALTER TABLE sp_transactions ADD CONSTRAINT sp_transaction_type_valid CHECK (type IN (
  'login_bonus', 'challenge_win', 'challenge_loss',
  'minigame_reward', 'admin_grant', 'admin_deduct',
  'gambling_spend', 'gambling_win'
));

INSERT INTO admin_config (key, value, description) VALUES
  ('gambling_enabled', 'true', 'Active/désactive globalement la section gambling'),
  ('gambling_max_wager_per_day', '50', 'SP total misé/jour sur le gambling, tous crates confondus, par joueur')
ON CONFLICT (key) DO NOTHING;
