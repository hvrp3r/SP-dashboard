import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// Les colonnes DATE (ex: users.last_login_date) sont renvoyées telles quelles en
// 'YYYY-MM-DD'. Par défaut, node-postgres les convertit en objet Date construit sur
// le calendrier LOCAL (new Date(year, month-1, day)), puis un .toISOString() ailleurs
// dans le code les repasse en UTC : dans un fuseau en avance sur UTC (ex: Europe/Paris),
// minuit local devient la veille en UTC, ce qui décale silencieusement la date d'un jour.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
