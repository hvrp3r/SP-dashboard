-- Tower : jeu de progression solo sur une grille de 3 cases par étage (comme
-- sur csgofast). Contrairement au Crash/Blackjack, pas de manche partagée
-- entre joueurs : chaque partie est strictement individuelle, avancée par
-- l'appel du joueur lui-même à chaque case cliquée (pas d'état à faire
-- avancer "à la lecture", pas de cron).
--
-- Le nombre de mines par étage dépend de la difficulté (voir
-- TOWER_DIFFICULTIES dans tower.service.ts) : seule la POSITION de la/des
-- mine(s) parmi les 3 cases est tirée au hasard à la création de la partie
-- (`mine_positions`, un tableau de positions par étage) — jamais révélée au
-- client pour un étage tant qu'il n'a pas été franchi (ou que la partie est
-- terminée), même principe que crash_point_x100 avant le crash (038_crash.sql).
--
-- Multiplicateurs entiers x100 (234 = 2.34x), même convention que
-- crash_point_x100 — voir le commentaire en tête de 038_crash.sql pour la
-- justification (éviter le parsing NUMERIC en chaîne de node-postgres).
--
-- Réutilise les types sp_transactions existants ('gambling_spend'/'gambling_win')
-- plutôt que d'en ajouter — le Tower partage donc directement le plafond
-- gambling_max_wager_per_day déjà en place pour les caisses/blackjack/crash.

CREATE TABLE tower_games (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  season_id INT REFERENCES seasons(id),
  difficulty VARCHAR(20) NOT NULL,
  bet_amount INT NOT NULL CHECK (bet_amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  current_level INT NOT NULL DEFAULT 0,
  mine_positions JSONB NOT NULL,   -- tableau (un par étage) de tableaux de positions minées (0-2)
  picks JSONB NOT NULL DEFAULT '[]', -- case choisie (0-2) pour chaque étage déjà franchi
  bet_transaction_id INT REFERENCES sp_transactions(id),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT tower_game_status_valid CHECK (status IN ('in_progress', 'cashed_out', 'busted')),
  CONSTRAINT tower_game_difficulty_valid CHECK (difficulty IN ('easy', 'medium', 'hard'))
);

CREATE INDEX idx_tower_games_user ON tower_games(user_id);

-- Une seule partie "vivante" à la fois par joueur — empêche un double
-- /start (deux onglets, double clic) de créer deux parties concurrentes
-- qui partageraient la même mise déjà débitée deux fois.
CREATE UNIQUE INDEX idx_tower_games_one_active ON tower_games(user_id) WHERE status = 'in_progress';

-- Interrupteur propre au Tower, indépendant de `gambling_enabled` (caisses),
-- `blackjack_enabled` et `crash_enabled` — même logique que 018/038. Désactivé
-- par défaut tant que le MSP ne l'a pas explicitement activé.
INSERT INTO admin_config (key, value, description) VALUES
  ('tower_enabled', 'false', 'Active/désactive le Tower (indépendant des caisses/blackjack/crash)')
ON CONFLICT (key) DO NOTHING;
