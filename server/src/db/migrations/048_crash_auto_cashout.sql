-- Retrait automatique du crash : le joueur fixe un multiplicateur cible (à la mise,
-- ou ensuite tant qu'il n'est pas retiré) ; le serveur le retire seul dès que ce
-- multiplicateur est atteint, à l'instant exact demandé (voir processAutoCashouts
-- dans crash.service.ts) plutôt qu'au multiplicateur constaté au prochain sondage
-- client, qui serait en retard de jusqu'à POLL_INTERVAL_RUNNING_MS.
ALTER TABLE crash_bets ADD COLUMN auto_cashout_multiplier_x100 INT;

ALTER TABLE crash_bets ADD CONSTRAINT crash_bets_auto_cashout_valid
  CHECK (auto_cashout_multiplier_x100 IS NULL OR auto_cashout_multiplier_x100 > 100);
