import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as seasonService from './season.service.js';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnlyString(value: string | Date | null): string | null {
  if (value === null) return null;
  // Le parseur pg pour DATE est neutralisé dans pool.ts : on reçoit toujours une
  // chaîne 'YYYY-MM-DD'. Le cas Date reste en filet de sécurité si ça change un jour.
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function isYesterday(lastLoginDate: string, today: string): boolean {
  const last = new Date(`${lastLoginDate}T00:00:00Z`).getTime();
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return last === yesterday.getTime();
}

export interface DailyBonusClaimResult {
  alreadyClaimed: boolean;
  amount: number;
  streak: number;
}

/**
 * Réclame le bonus de connexion quotidienne (+ streak) pour la date UTC courante,
 * à l'appel explicite du joueur (bouton "Réclamer" sur son profil). Idempotent :
 * un second appel le même jour renvoie `alreadyClaimed: true` sans re-créditer.
 *
 * Tout se passe dans une seule transaction avec verrou de ligne (SELECT ... FOR UPDATE) :
 * plusieurs clics ou onglets peuvent appeler cette fonction en parallèle pour le même
 * utilisateur. Sans ce verrou, ils liraient tous last_login_date avant qu'aucun ne l'ait
 * mis à jour et créditeraient le bonus plusieurs fois pour la même journée. Le verrou
 * sérialise les appels concurrents du même utilisateur : le second attend que le premier
 * commite, puis voit last_login_date déjà à jour et s'arrête sans rien créditer.
 */
export async function claimDailyLoginBonus(userId: number): Promise<DailyBonusClaimResult> {
  const today = todayUTC();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      last_login_date: string | Date | null;
      login_streak: number;
    }>('SELECT last_login_date, login_streak FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = rows[0];
    if (!user) {
      throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
    }

    const lastLoginDate = toDateOnlyString(user.last_login_date);
    if (lastLoginDate === today) {
      await client.query('ROLLBACK');
      return { alreadyClaimed: true, amount: 0, streak: user.login_streak };
    }

    const newStreak = lastLoginDate && isYesterday(lastLoginDate, today) ? user.login_streak + 1 : 1;

    await client.query('UPDATE users SET login_streak = $1, last_login_date = $2 WHERE id = $3', [
      newStreak,
      today,
      userId,
    ]);

    const [base, step, max, requiredDays] = await Promise.all([
      configService.getConfigNumber('login_bonus_base', 10),
      configService.getConfigNumber('streak_bonus_step', 2),
      configService.getConfigNumber('streak_bonus_max', 20),
      configService.getConfigNumber('streak_required_days', 7),
    ]);

    const streakBonus =
      requiredDays > 0 ? Math.min(Math.floor(newStreak / requiredDays) * step, max) : 0;
    const totalAmount = base + streakBonus;

    if (totalAmount > 0) {
      const activeSeason = await seasonService.getActiveSeason();
      await spService.creditSP({
        userId,
        amount: totalAmount,
        type: 'login_bonus',
        seasonId: activeSeason?.id ?? null,
        note: `Bonus quotidien (streak ${newStreak})`,
        client,
      });
    }

    await client.query('COMMIT');
    return { alreadyClaimed: false, amount: totalAmount, streak: newStreak };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
