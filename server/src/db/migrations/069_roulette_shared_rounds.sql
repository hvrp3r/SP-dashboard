-- Remplace la Roulette solo (068_roulette.sql) par une table partagée entre
-- joueurs, sur le même principe que le Blackjack (017_blackjack.sql) et le
-- Crash (038_crash.sql) : une seule "manche" vivante à la fois, état avancé
-- "à la lecture" (pas de cron, pas de websocket) via une fonction
-- advanceRound appelée en tête de chaque endpoint. La table 068 est toute
-- neuve et ne porte aucune donnée économique réelle à préserver — elle est
-- remplacée proprement plutôt que migrée.
--
-- `winning_number` est tiré au hasard à la CRÉATION de la manche (même
-- principe que crash_point_x100 dans 038_crash.sql) et reste caché côté
-- client (toPublicView) tant que status != 'finished' : personne — y
-- compris le joueur qui vient de miser — ne peut influencer ou deviner le
-- résultat avant que les mises ne soient closes.
--
-- `starts_at` reste NULL tant qu'aucun pari n'a été posé (même raison que
-- Blackjack/Crash : une table vide ne doit pas faire tourner un compte à
-- rebours dans le vide) ; il est fixé à la première mise, déclenchant la
-- fenêtre de mise commune à tous les joueurs.

DROP TABLE IF EXISTS roulette_rounds;

CREATE TABLE roulette_rounds (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  status VARCHAR(20) NOT NULL DEFAULT 'betting',
  winning_number INT NOT NULL,
  starts_at TIMESTAMPTZ,
  spin_ends_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT roulette_round_status_valid CHECK (status IN ('betting', 'spinning', 'finished')),
  CONSTRAINT roulette_round_winning_number_valid CHECK (winning_number BETWEEN 0 AND 36)
);

CREATE INDEX idx_roulette_rounds_status ON roulette_rounds(status);

-- Un joueur peut poser plusieurs paris différents dans la même manche (pas
-- une seule "main" comme au Blackjack) : pas de UNIQUE (round_id, user_id)
-- ici, mais un même joueur qui reclique sur la même case incrémente son pari
-- existant (voir placeBet, upsert ON CONFLICT) plutôt que de créer une ligne
-- par clic — d'où l'index unique normalisé ci-dessous (NULL n'étant pas
-- "égal à lui-même" dans une contrainte unique standard, on normalise via
-- COALESCE pour que deux paris "red" du même joueur soient bien vus comme
-- le même pari).
CREATE TABLE roulette_bets (
  id SERIAL PRIMARY KEY,
  round_id INT REFERENCES roulette_rounds(id),
  user_id INT REFERENCES users(id),
  type VARCHAR(20) NOT NULL,
  number INT,
  amount INT NOT NULL CHECK (amount > 0),
  payout INT,
  bet_transaction_id INT REFERENCES sp_transactions(id),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roulette_bet_number_valid CHECK (number IS NULL OR number BETWEEN 0 AND 36)
);

CREATE INDEX idx_roulette_bets_round ON roulette_bets(round_id);
CREATE UNIQUE INDEX idx_roulette_bets_unique ON roulette_bets(round_id, user_id, type, COALESCE(number, -1));
