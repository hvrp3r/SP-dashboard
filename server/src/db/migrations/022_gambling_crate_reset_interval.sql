-- Permet au MSP de configurer une caisse dont la limite d'ouvertures par
-- joueur (max_opens_per_player) se réinitialise périodiquement (tous les
-- jours, tous les 3 jours, toutes les semaines, etc.) plutôt que de rester
-- une limite à vie. NULL (comportement existant, inchangé par défaut) =
-- limite à vie, jamais réinitialisée.
ALTER TABLE gambling_crates
  ADD COLUMN reset_interval_days INT CHECK (reset_interval_days IS NULL OR reset_interval_days > 0);

-- Un intervalle de reset n'a de sens que s'il y a une limite à réinitialiser.
ALTER TABLE gambling_crates ADD CONSTRAINT gambling_crates_reset_requires_limit
  CHECK (reset_interval_days IS NULL OR max_opens_per_player IS NOT NULL);

-- Calcule le début de la période de reset en cours pour un intervalle donné
-- (en jours), en heure locale Europe/Paris — même exception délibérée que le
-- bonus de connexion quotidien et le budget gambling journalier (voir
-- CLAUDE.md sections 3 et 7). Les périodes sont ancrées sur l'epoch Unix
-- (1970-01-01, un jeudi) : avec interval_days=1 ça reproduit exactement un
-- reset à minuit local (identique à startOfDayLocalAsUTC() côté JS), et pour
-- des intervalles plus longs (3 jours, 7 jours...) ça donne des périodes
-- fixes et déterministes, identiques pour tous les joueurs, sans avoir à
-- stocker une date d'ancrage par caisse.
CREATE OR REPLACE FUNCTION gambling_period_start(interval_days INT)
RETURNS TIMESTAMPTZ AS $$
  SELECT (
    DATE '1970-01-01' + (
      (((now() AT TIME ZONE 'Europe/Paris')::date - DATE '1970-01-01') / interval_days) * interval_days
    )
  )::timestamp AT TIME ZONE 'Europe/Paris';
$$ LANGUAGE SQL STABLE;
