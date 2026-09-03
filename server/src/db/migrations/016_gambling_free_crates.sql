-- Autorise les caisses gratuites (cost_sp = 0), mais uniquement pour les
-- caisses limitées (max_opens_per_player défini) : sans ça, une caisse
-- gratuite et illimitée serait une fuite de SP infinie.
ALTER TABLE gambling_crates DROP CONSTRAINT gambling_crates_cost_sp_check;
ALTER TABLE gambling_crates ADD CONSTRAINT gambling_crates_cost_sp_non_negative CHECK (cost_sp >= 0);
ALTER TABLE gambling_crates ADD CONSTRAINT gambling_crates_free_requires_limit
  CHECK (cost_sp > 0 OR max_opens_per_player IS NOT NULL);
