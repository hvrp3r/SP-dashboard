-- Empilage de cosmétiques + enchères entre joueurs.
--
-- Jusqu'ici un joueur ne pouvait posséder qu'un seul exemplaire de chaque
-- cosmétique (UNIQUE (user_id, cosmetic_id) sur user_cosmetics) : un gain en
-- double (caisse gambling ou octroi MSP) était silencieusement ignoré. On
-- introduit `quantity` : la ligne reste unique par (user_id, cosmetic_id),
-- c'est son quantity qui monte. À 0 (après revente complète) la ligne est
-- conservée plutôt que supprimée — même principe "jamais de suppression" que
-- les transactions révoquées ou les défis annulés ailleurs dans l'app.
ALTER TABLE user_cosmetics ADD COLUMN quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0);

-- Une enchère porte toujours sur un seul exemplaire d'un cosmétique précis.
-- Système d'enchère à durée (pas d'achat immédiat) : prix de départ, les
-- joueurs surenchérissent, le plus offrant à la fin remporte le cosmétique.
-- Résolution paresseuse (check à la lecture), même pattern que l'expiration
-- des défis 24h dans challenge.service.ts#expirePendingChallenges — pas de
-- cron dans ce projet.
CREATE TABLE cosmetic_auctions (
  id SERIAL PRIMARY KEY,
  seller_id INT NOT NULL REFERENCES users(id),
  cosmetic_id INT NOT NULL REFERENCES cosmetics(id),
  starting_price INT NOT NULL CHECK (starting_price > 0),
  current_bid INT,
  current_bidder_id INT REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  cancelled_by INT REFERENCES users(id),
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX idx_cosmetic_auctions_status ON cosmetic_auctions(status);
CREATE INDEX idx_cosmetic_auctions_seller ON cosmetic_auctions(seller_id);

-- Historique de chaque offre (transparence/traçabilité, même logique que
-- gambling_opens). Une seule offre 'active' à la fois par enchère (la plus
-- haute courante) ; une offre dépassée passe 'refunded' (son SP est
-- immédiatement remboursé), la gagnante passe 'won' à la résolution.
CREATE TABLE cosmetic_auction_bids (
  id SERIAL PRIMARY KEY,
  auction_id INT NOT NULL REFERENCES cosmetic_auctions(id),
  bidder_id INT NOT NULL REFERENCES users(id),
  amount INT NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded', 'won')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hold_transaction_id INT REFERENCES sp_transactions(id),
  refund_transaction_id INT REFERENCES sp_transactions(id)
);
CREATE INDEX idx_cosmetic_auction_bids_auction ON cosmetic_auction_bids(auction_id);

INSERT INTO admin_config (key, value, description) VALUES
  ('auction_min_duration_hours', '1', 'Durée minimale (en heures) d''une enchère de cosmétique'),
  ('auction_max_duration_hours', '72', 'Durée maximale (en heures) d''une enchère de cosmétique'),
  ('auction_min_bid_increment', '1', 'Surenchère minimale (en SP) requise pour dépasser l''offre actuelle')
ON CONFLICT (key) DO NOTHING;
