// Fuseau horaire utilisé pour les frontières de journée qui doivent correspondre
// au ressenti des joueurs (bonus quotidien, budget gambling journalier) plutôt
// qu'à minuit UTC. Exception délibérée à la règle "tout en UTC" du reste de
// l'app — voir CLAUDE.md section 3 et 7.
const LOCAL_TIMEZONE = 'Europe/Paris';

/**
 * Date du jour (YYYY-MM-DD) dans le fuseau local. Intl.DateTimeFormat gère
 * nativement le passage heure d'été/hiver (CET/CEST), pas de calcul d'offset
 * manuel nécessaire ici.
 */
export function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TIMEZONE }).format(new Date());
}

/**
 * Instant UTC correspondant à minuit dans le fuseau local, pour aujourd'hui.
 * Utilisé pour filtrer "les transactions d'aujourd'hui" (`created_at >= ...`)
 * sur une frontière de journée locale plutôt que UTC.
 *
 * Technique : on formate un instant candidat (minuit UTC de la date locale du
 * jour) à la fois dans le fuseau local et en UTC, et on utilise l'écart entre
 * les deux comme décalage réel du fuseau à cette date précise (couvre CET/CEST
 * automatiquement, contrairement à un offset fixe codé en dur).
 */
export function startOfDayLocalAsUTC(): Date {
  const dateStr = todayLocal();
  const utcMidnightGuess = new Date(`${dateStr}T00:00:00.000Z`);
  const asLocal = new Date(utcMidnightGuess.toLocaleString('en-US', { timeZone: LOCAL_TIMEZONE }));
  const asUTC = new Date(utcMidnightGuess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asUTC.getTime() - asLocal.getTime();
  return new Date(utcMidnightGuess.getTime() + offsetMs);
}
