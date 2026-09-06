-- Machine à sous "Trois Petits Cochons" : jeu solo, une seule mise = un seul
-- spin résolu entièrement dans la même requête (pas de manche partagée, pas
-- d'état "à faire avancer à la lecture" comme Blackjack/Crash — encore plus
-- simple que le Tower, qui lui garde une partie en cours entre les requêtes).
--
-- 3 rouleaux, un seul payline (les 3 symboles visibles). Poids de tirage
-- identiques sur les 3 rouleaux (SLOT_SYMBOLS dans slots.service.ts) ; le
-- symbole "wild" se substitue à n'importe quel autre symbole pour compléter
-- un triple (y compris "gem", le symbole jackpot). Un triple des symboles de
-- bas étage (paille/bois/briques/cochon) paie aussi sur un simple doublé (2
-- des 3 rouleaux, le troisième différent et non wild) — les symboles rares
-- (loup/maison/wild/gem) ne paient que sur un triple complet, pour garder les
-- gros gains rares.
--
-- RTP fixe de 96% (SLOTS_RTP_PERCENT, même valeur que Crash/Tower), calibré
-- par énumération exacte des combinaisons (pas de simulation) sur les
-- poids/multiplicateurs fixés dans slots.service.ts.
--
-- Réutilise les types sp_transactions existants ('gambling_spend'/'gambling_win')
-- comme tous les autres jeux de gambling — partage donc directement le
-- plafond gambling_max_wager_per_day.

CREATE TABLE slot_spins (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  season_id INT REFERENCES seasons(id),
  bet_amount INT NOT NULL CHECK (bet_amount > 0),
  reels JSONB NOT NULL,             -- ex: ["straw","wolf","straw"], toujours 3 éléments
  win_symbol VARCHAR(20),           -- symbole payé ('wild' si triple wild) ; NULL si aucun gain
  win_tier VARCHAR(10),             -- 'double' | 'triple' ; NULL si aucun gain
  payout INT NOT NULL DEFAULT 0,
  bet_transaction_id INT REFERENCES sp_transactions(id),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slot_spins_win_tier_valid CHECK (win_tier IS NULL OR win_tier IN ('double', 'triple'))
);

CREATE INDEX idx_slot_spins_user ON slot_spins(user_id);

-- Interrupteur propre aux Slots, indépendant des autres jeux de gambling —
-- même logique que 018/038/041. Désactivé par défaut tant que le MSP ne l'a
-- pas explicitement activé.
INSERT INTO admin_config (key, value, description) VALUES
  ('slots_enabled', 'false', 'Active/désactive la machine à sous (indépendant des caisses/blackjack/crash/tower)')
ON CONFLICT (key) DO NOTHING;
