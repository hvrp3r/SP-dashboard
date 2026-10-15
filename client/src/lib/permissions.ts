import type { EventSession, User } from '../types.js';

// Miroir client de server/src/services/permission.service.ts — sert uniquement
// à afficher/masquer les contrôles, le serveur revérifie toujours.

export function canCreateEvents(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || (user.permissions ?? []).includes('event_organizer');
}

/** MSP : toutes les sessions ; organisateur : uniquement celles qu'il a créées. */
export function canManageSession(
  user: User | null | undefined,
  session: Pick<EventSession, 'created_by'>
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return session.created_by === user.id && canCreateEvents(user);
}
