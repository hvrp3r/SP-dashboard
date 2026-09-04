-- Permet au MSP de choisir, pour une transaction manuelle (admin_grant/admin_deduct),
-- si elle impacte sp_total_earned ou seulement sp_balance (ex: correction d'erreur,
-- prêt temporaire) sans fausser le classement trié par total gagné. Toutes les
-- transactions existantes gardent le comportement actuel (impact total_earned).
ALTER TABLE sp_transactions
  ADD COLUMN affects_total_earned BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill : historiquement, seuls les crédits (amount > 0) incrémentaient
-- sp_total_earned ; les débits (amount < 0) ne l'ont jamais touché. Sans ce
-- correctif, une révocation future d'un vieux débit (ex: gambling_spend)
-- gonflerait à tort le total gagné du joueur.
UPDATE sp_transactions SET affects_total_earned = FALSE WHERE amount < 0;
