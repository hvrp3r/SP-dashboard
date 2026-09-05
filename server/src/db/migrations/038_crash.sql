-- Crash : une seule manche "vivante" à la fois, même pattern que le blackjack
-- (017_blackjack.sql) — état avancé "à la lecture", pas de cron. Un multiplicateur
-- grimpe de façon déterministe en fonction du temps écoulé depuis started_at (même
-- formule côté serveur et client, voir crash.service.ts), jusqu'à un point de crash
-- tiré au hasard à la création de la manche mais gardé secret côté client jusqu'au
-- crash. Chaque joueur mise pendant la phase 'betting', peut se retirer à tout
-- moment pendant 'running' pour empocher mise × multiplicateur courant ; s'il ne se
-- retire pas avant le crash, sa mise (déjà débitée) est perdue.
--
-- Multiplicateurs stockés en entier × 100 (234 = 2.34x) plutôt qu'en NUMERIC :
-- node-postgres renvoie les colonnes NUMERIC sous forme de chaînes par défaut
-- (aucun type parser custom en place ici, contrairement à DATE dans db/pool.ts),
-- ce qui aurait exigé de parser à chaque usage ; un entier reste un JS number
-- natif de bout en bout, et reste dans l'esprit "SP toujours en entier" du projet.
--
-- Réutilise les types sp_transactions existants ('gambling_spend'/'gambling_win')
-- plutôt que d'en ajouter — le crash partage donc directement le plafond
-- gambling_max_wager_per_day et la barre de budget déjà en place pour les
-- caisses/le blackjack, sans aucune modification de ce côté.

CREATE TABLE crash_rounds (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  status VARCHAR(20) NOT NULL DEFAULT 'betting',
  crash_point_x100 INT NOT NULL,  -- tiré à la création, caché du client tant que status != 'crashed'
  starts_at TIMESTAMPTZ,          -- 1re mise + BETTING_WINDOW_SECONDS ; NULL tant qu'aucune mise
  started_at TIMESTAMPTZ,         -- passage à 'running'
  crashed_at TIMESTAMPTZ,         -- instant du crash, calculé dès le passage à 'running' (started_at + f(crash_point))
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT crash_round_status_valid CHECK (status IN ('betting', 'running', 'crashed')),
  CONSTRAINT crash_round_point_valid CHECK (crash_point_x100 >= 100)
);

CREATE TABLE crash_bets (
  id SERIAL PRIMARY KEY,
  round_id INT REFERENCES crash_rounds(id),
  user_id INT REFERENCES users(id),
  bet_amount INT NOT NULL CHECK (bet_amount > 0),
  cashout_multiplier_x100 INT,    -- NULL tant que non retiré ; figé au retrait, jamais rempli si emporté par le crash
  bet_transaction_id INT REFERENCES sp_transactions(id),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,        -- fixé au retrait, ou au crash pour ceux qui n'ont pas retiré à temps
  UNIQUE (round_id, user_id)
);

CREATE INDEX idx_crash_bets_round ON crash_bets(round_id);
CREATE INDEX idx_crash_rounds_status ON crash_rounds(status);

-- Interrupteur propre au crash, indépendant de `gambling_enabled` (caisses) et
-- `blackjack_enabled` — même logique que 018_blackjack_enabled.sql. Désactivé
-- par défaut tant que le MSP ne l'a pas explicitement activé.
INSERT INTO admin_config (key, value, description) VALUES
  ('crash_enabled', 'false', 'Active/désactive le Crash (indépendant des caisses/blackjack)')
ON CONFLICT (key) DO NOTHING;
