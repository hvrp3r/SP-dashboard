-- Description libre pour un défi, et possibilité pour le MSP de l'annuler.
-- Annuler un défi déjà résolu révoque ses transactions SP (gain/perte) via le
-- même mécanisme que la révocation de transaction individuelle.
ALTER TABLE challenges
  ADD COLUMN description TEXT,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancelled_by INT REFERENCES users(id);

ALTER TABLE challenges DROP CONSTRAINT challenge_status_valid;
ALTER TABLE challenges ADD CONSTRAINT challenge_status_valid CHECK (status IN (
  'pending', 'accepted', 'declined', 'expired', 'resolved', 'cancelled'
));
