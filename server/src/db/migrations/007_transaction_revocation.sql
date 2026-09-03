-- Permet au MSP de révoquer une transaction SP par erreur : on ne supprime jamais
-- une ligne d'historique, on marque la transaction d'origine comme révoquée et une
-- transaction d'ajustement inverse est créée séparément (via creditSP/debitSP).
ALTER TABLE sp_transactions
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN revoked_by INT REFERENCES users(id);
