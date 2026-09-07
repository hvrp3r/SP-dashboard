-- Case battle : plusieurs joueurs rejoignent une même session (`gambling_battles`),
-- payent chacun le même coût d'entrée (somme des coûts des caisses choisies par le
-- créateur, figée dans `cost_sp` à la création — un changement de prix d'une caisse
-- après coup n'affecte pas les batailles déjà créées), puis ouvrent individuellement
-- les mêmes caisses, dans le même ordre (`gambling_battle_crates.position`, un
-- multiset : une caisse peut apparaître plusieurs fois). Contrairement à l'ouverture
-- solo, aucun gain n'est crédité au fil des tirages : tout est mis en pot, et à la
-- fin de la bataille le joueur ayant tiré le plus de SP au total rafle l'intégralité
-- des gains SP de TOUS les participants, ainsi que tous les cosmétiques tirés par
-- n'importe qui pendant la bataille — décision explicite de l'utilisateur ("winner
-- takes all", y compris les cosmétiques). En cas d'égalité, le pot SP est partagé à
-- parts égales entre les vainqueurs (voir gambling_battle_winners) et chaque
-- cosmétique tiré est accordé à chacun d'eux (pas de découpage possible d'un objet).
--
-- Réutilise les types sp_transactions existants ('gambling_spend' pour l'entrée,
-- 'gambling_win' pour le gain final) plutôt que d'en ajouter — même choix que le
-- crash (038_crash.sql) : la bataille partage directement le plafond
-- gambling_max_wager_per_day et la barre de budget déjà en place, sans aucune
-- modification de ce côté. Même chose pour `user_cosmetics.obtained_source`
-- ('gambling', voir 024_cosmetics.sql) pour les cosmétiques accordés au vainqueur.
--
-- Déroulement au tirage figé à l'avance, révélé progressivement (même pattern que
-- crash_rounds/blackjack_sessions) : dès que `max_players` est atteint, tous les
-- tirages de tous les participants pour toutes les caisses sont faits en une fois
-- et stockés (`gambling_battle_opens`), `started_at` est posé, et chaque caisse à
-- la position i se révèle côté client à started_at + i × durée d'un rouleau (durée
-- fixe côté service ET client, comme GROWTH_PER_SECOND pour le crash) — la
-- résolution (calcul du vainqueur, crédit du pot) n'a lieu qu'une fois la dernière
-- caisse révélée, avancée paresseusement à la lecture comme les autres jeux.
CREATE TABLE gambling_battles (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id),
  created_by INT NOT NULL REFERENCES users(id),
  max_players INT NOT NULL CHECK (max_players BETWEEN 2 AND 6),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'in_progress', 'completed', 'cancelled')),
  cost_sp INT NOT NULL CHECK (cost_sp >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gambling_battles_status ON gambling_battles (status, created_at DESC);

-- Multiset ordonné des caisses d'une bataille (une même caisse peut apparaître
-- plusieurs fois, à des positions différentes).
CREATE TABLE gambling_battle_crates (
  id SERIAL PRIMARY KEY,
  battle_id INT NOT NULL REFERENCES gambling_battles(id),
  crate_id INT NOT NULL REFERENCES gambling_crates(id),
  position INT NOT NULL CHECK (position >= 0),
  UNIQUE (battle_id, position)
);

CREATE TABLE gambling_battle_participants (
  id SERIAL PRIMARY KEY,
  battle_id INT NOT NULL REFERENCES gambling_battles(id),
  user_id INT NOT NULL REFERENCES users(id),
  is_creator BOOLEAN NOT NULL DEFAULT FALSE,
  entry_transaction_id INT REFERENCES sp_transactions(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (battle_id, user_id)
);

-- Un tirage par participant par caisse de la bataille — tous insérés d'un coup
-- au démarrage (voir commentaire d'en-tête), jamais recalculés ensuite.
-- `resolved_cosmetic_id` fige le cosmétique concret tiré pour un gain "pool"
-- (filtre catégorie/rareté sans cosmetic_id précis), pour que l'animation puis
-- l'attribution finale au vainqueur portent exactement sur le même objet.
CREATE TABLE gambling_battle_opens (
  id SERIAL PRIMARY KEY,
  battle_crate_id INT NOT NULL REFERENCES gambling_battle_crates(id),
  participant_id INT NOT NULL REFERENCES gambling_battle_participants(id),
  reward_id INT NOT NULL REFERENCES gambling_crate_rewards(id),
  resolved_cosmetic_id INT REFERENCES cosmetics(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (battle_crate_id, participant_id)
);

CREATE INDEX idx_gambling_battle_opens_participant ON gambling_battle_opens (participant_id);

-- Un ou plusieurs vainqueurs (égalité = pot SP partagé à parts égales, chaque
-- cosmétique tiré dupliqué pour chacun). `share_amount` = part du pot SP total
-- réellement créditée à ce vainqueur (déjà divisée en cas d'égalité).
CREATE TABLE gambling_battle_winners (
  id SERIAL PRIMARY KEY,
  battle_id INT NOT NULL REFERENCES gambling_battles(id),
  user_id INT NOT NULL REFERENCES users(id),
  share_amount INT NOT NULL CHECK (share_amount >= 0),
  payout_transaction_id INT REFERENCES sp_transactions(id),
  UNIQUE (battle_id, user_id)
);
