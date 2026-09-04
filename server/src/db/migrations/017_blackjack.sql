-- Blackjack multijoueur : une seule table "vivante" à la fois (pas de lobby
-- créé/nommé par un joueur, pas de pot commun — chaque joueur mise ce qu'il
-- veut et joue sa propre main contre le croupier). État avancé "à la lecture"
-- (même pattern que l'expiration des défis dans challenge.service.ts), pas de
-- cron : chaque requête sur la session courante fait avancer l'état si le
-- temps est écoulé (démarrage 15s après la 1re mise, auto-stand après le
-- délai de décision, résolution dès que toutes les mains sont jouées).
--
-- Réutilise les types sp_transactions existants ('gambling_spend'/'gambling_win')
-- plutôt que d'en ajouter — le blackjack partage donc directement le plafond
-- gambling_max_wager_per_day et la barre de budget déjà en place pour les
-- caisses, sans aucune modification de ce côté.

CREATE TABLE blackjack_sessions (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  starts_at TIMESTAMPTZ,           -- 1re mise + 15s ; NULL tant qu'aucune mise
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  dealer_cards JSONB NOT NULL DEFAULT '[]',
  dealer_hole_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT blackjack_session_status_valid CHECK (status IN ('waiting', 'active', 'finished'))
);

CREATE TABLE blackjack_hands (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES blackjack_sessions(id),
  user_id INT REFERENCES users(id),
  bet_amount INT NOT NULL CHECK (bet_amount > 0),
  cards JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'playing',
  outcome VARCHAR(20),
  bet_transaction_id INT REFERENCES sp_transactions(id),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  action_deadline TIMESTAMPTZ,      -- fixé à la distribution ; auto-stand si dépassé
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (session_id, user_id),
  CONSTRAINT blackjack_hand_status_valid CHECK (status IN ('playing', 'stood', 'busted')),
  CONSTRAINT blackjack_hand_outcome_valid CHECK (outcome IS NULL OR outcome IN ('win', 'blackjack', 'push', 'lose'))
);

CREATE INDEX idx_blackjack_hands_session ON blackjack_hands(session_id);
CREATE INDEX idx_blackjack_sessions_status ON blackjack_sessions(status);
