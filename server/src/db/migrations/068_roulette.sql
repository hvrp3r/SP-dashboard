-- Roulette : contrairement au Tower (partie en plusieurs étapes), une manche
-- de roulette se résout entièrement en un seul appel serveur (poser un ou
-- plusieurs paris + lancer la roue) — pas d'état "in_progress" à conserver,
-- une ligne = une manche déjà entièrement réglée.
--
-- `bets` stocke le détail de chaque pari posé par le joueur pour cette
-- manche (type, numéro le cas échéant, montant, et gain individuel calculé
-- au règlement) — traçabilité anti-triche, même esprit que gambling_opens.
--
-- Réutilise les types sp_transactions existants ('gambling_spend'/'gambling_win')
-- plutôt que d'en ajouter — la Roulette partage donc directement le plafond
-- gambling_max_wager_per_day déjà en place pour les caisses/blackjack/crash/tower.

CREATE TABLE roulette_rounds (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  season_id INT REFERENCES seasons(id),
  bets JSONB NOT NULL,
  winning_number INT NOT NULL CHECK (winning_number BETWEEN 0 AND 36),
  total_wager INT NOT NULL CHECK (total_wager > 0),
  total_payout INT NOT NULL DEFAULT 0,
  bet_transaction_id INT REFERENCES sp_transactions(id),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_roulette_rounds_user ON roulette_rounds(user_id);

-- Interrupteur propre à la Roulette, indépendant de `gambling_enabled`
-- (caisses), `blackjack_enabled`, `crash_enabled` et `tower_enabled` — même
-- logique que 018/038/041. Désactivé par défaut tant que le MSP ne l'a pas
-- explicitement activé.
INSERT INTO admin_config (key, value, description) VALUES
  ('roulette_enabled', 'false', 'Active/désactive la Roulette (indépendant des caisses/blackjack/crash/tower)')
ON CONFLICT (key) DO NOTHING;
