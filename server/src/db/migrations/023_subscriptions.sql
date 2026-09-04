-- Abonnement encaissé hors-plateforme via Ko-fi — pas de micro-entreprise
-- nécessaire, l'argent sert uniquement à financer les serveurs. Liberapay a
-- été écarté : pas de webhook, seulement un compteur de patrons agrégé,
-- impossible d'identifier un paiement individuel (voir CLAUDE.md section 8).
-- Ko-fi ne notifie que les paiements réussis (aucun événement d'annulation) :
-- l'accès expire donc de lui-même faute de renouvellement plutôt que d'être
-- révoqué activement.
-- Un don ponctuel ("one time") donne le même statut abonné (même durée
-- d'accès) qu'un paiement d'abonnement récurrent ("monthly") — décision
-- explicite de l'utilisateur : les deux modes du widget Ko-fi doivent
-- débloquer les mêmes avantages. Le prix plancher n'est PAS vérifié côté app
-- (décision explicite) : il est configuré directement sur la page Ko-fi, une
-- seule source de vérité sur le prix plutôt qu'une valeur dupliquée ici.

CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'inactive',
  -- Code court affiché sur le profil, à coller dans le message du tout premier
  -- paiement Ko-fi pour relier ce compte à l'abonnement (le champ message
  -- n'est fourni par Ko-fi que sur le premier paiement d'un abonnement, jamais
  -- sur les renouvellements — voir subscription.service.ts).
  link_code VARCHAR(12) NOT NULL UNIQUE,
  -- Email Ko-fi capturé au premier paiement matché, réutilisé pour rattacher
  -- automatiquement les renouvellements suivants (dont le message est vide).
  kofi_email TEXT,
  current_period_end TIMESTAMPTZ,
  last_payment_at TIMESTAMPTZ,
  activated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT subscription_status_valid CHECK (status IN ('inactive', 'active'))
);

-- Historique brut de chaque paiement Ko-fi reçu : sert à la fois d'idempotence
-- (Ko-fi retente l'envoi avec le même message_id tant qu'il ne reçoit pas un
-- 200) et de file d'attente pour que le MSP rattache manuellement un paiement
-- dont le code de liaison ne correspondait à personne (faute de frappe,
-- premier paiement sans code, etc.).
CREATE TABLE kofi_events (
  id SERIAL PRIMARY KEY,
  kofi_transaction_id TEXT NOT NULL UNIQUE,
  message_id TEXT NOT NULL,
  type VARCHAR(30) NOT NULL,
  is_subscription_payment BOOLEAN NOT NULL,
  is_first_subscription_payment BOOLEAN NOT NULL,
  from_name TEXT,
  email TEXT,
  amount NUMERIC(10, 2),
  currency VARCHAR(10),
  message TEXT,
  tier_name TEXT,
  kofi_timestamp TIMESTAMPTZ NOT NULL,
  matched_user_id INT REFERENCES users(id),
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kofi_events_matched_user ON kofi_events(matched_user_id);
CREATE INDEX idx_kofi_events_email ON kofi_events(email);
CREATE INDEX idx_kofi_events_unmatched ON kofi_events(received_at) WHERE matched_user_id IS NULL;

-- Caisse "abonnés" : réutilise entièrement le système de caisses existant
-- (pool de récompenses, tirage pondéré…), seule l'ouverture est conditionnée
-- à un abonnement actif plutôt qu'à un coût SP.
ALTER TABLE gambling_crates
  ADD COLUMN requires_subscription BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO admin_config (key, value, description) VALUES
  ('kofi_subscription_period_days', '35', 'Durée en jours pendant laquelle un abonnement Ko-fi reste actif après un paiement reçu (marge de sécurité sur le cycle mensuel de 30 jours, Ko-fi ne notifiant pas les annulations)')
ON CONFLICT (key) DO NOTHING;
