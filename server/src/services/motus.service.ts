import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import { todayLocal } from '../utils/localDate.js';
import { isDictionaryWord } from '../utils/frenchDictionary.js';
import type {
  MotusAttemptHistoryEntry,
  MotusAttemptRow,
  MotusDailyWordRow,
  MotusGameStatus,
  MotusGameView,
  MotusHistoryEntry,
  MotusLetterState,
  MotusTodayAdminView,
  MotusWordQueueRow,
} from '../types.js';

/**
 * Dictionnaire interne utilisé quand la file MSP est vide — mots communs,
 * lettres A-Z uniquement (voir note en tête de 042_motus.sql sur le choix de
 * ne pas gérer les accents). Volontairement varié en longueur (5 à 9 lettres)
 * pour ne pas rendre le mot du jour trivialement devinable par sa taille.
 */
const WORD_DICTIONARY = [
  'MAISON', 'VOITURE', 'JARDIN', 'FENETRE', 'LUMIERE', 'MONTAGNE', 'RIVIERE', 'PLANETE',
  'HISTOIRE', 'MUSIQUE', 'PEINTURE', 'VOYAGE', 'LECTURE', 'CUISINE', 'CHATEAU', 'FORET',
  'PLAGE', 'DESERT', 'GLACIER', 'VOLCAN', 'ETOILE', 'PLANTE', 'ANIMAL', 'OISEAU',
  'POISSON', 'INSECTE', 'REPTILE', 'TIGRE', 'ELEPHANT', 'GIRAFE', 'SINGE', 'RENARD',
  'AIGLE', 'HIBOU', 'CANARD', 'MOUTON', 'CHEVAL', 'VACHE', 'COCHON', 'POULET',
  'FROMAGE', 'BEURRE', 'SUCRE', 'FARINE', 'POMME', 'ORANGE', 'BANANE', 'CERISE',
  'FRAISE', 'CITRON', 'MELON', 'RAISIN', 'CAROTTE', 'TOMATE', 'OIGNON', 'SALADE',
  'POIVRE', 'GATEAU', 'BISCUIT', 'GLACE', 'SOUPE', 'PATES', 'VIANDE', 'ECOLE',
  'LIVRE', 'CAHIER', 'CRAYON', 'STYLO', 'TABLE', 'CHAISE', 'ARMOIRE', 'MIROIR',
  'RIDEAU', 'LAMPE', 'HORLOGE', 'MONTRE', 'BIJOU', 'BAGUE', 'COLLIER', 'CHAPEAU',
  'MANTEAU', 'CHEMISE', 'PANTALON', 'ECHARPE', 'VALISE', 'BAGAGE', 'TRAIN', 'AVION',
  'BATEAU', 'CAMION', 'ROUTE', 'PONT', 'TUNNEL', 'USINE', 'BUREAU', 'MAGASIN',
  'MARCHE', 'BANQUE', 'MEDECIN', 'DENTISTE', 'AVOCAT', 'POMPIER', 'FACTEUR', 'ETUDIANT',
  'ELEVE', 'EMPLOYE', 'OUVRIER', 'ARTISTE', 'MUSICIEN', 'CHANTEUR', 'DANSEUR', 'ACTEUR',
  'ECRIVAIN', 'ORDINATEUR', 'CLAVIER', 'ECRAN', 'IMPRIMANTE', 'TELEPHONE', 'CAMERA',
  'BATTERIE', 'CHARGEUR', 'CASQUE', 'ENCEINTE', 'JOURNAL', 'MAGAZINE', 'ROMAN',
  'AVENTURE', 'MYSTERE', 'LEGENDE', 'CHANSON', 'CONCERT', 'FESTIVAL', 'CINEMA',
  'THEATRE', 'SPECTACLE', 'FOOTBALL', 'BASKET', 'TENNIS', 'NATATION', 'CYCLISME',
  'ATHLETE', 'VICTOIRE', 'MEDAILLE', 'TROPHEE', 'EQUIPE', 'JOUEUR', 'ARBITRE',
];

function normalizeWord(raw: string): string {
  return raw.trim().toUpperCase();
}

function isValidWord(word: string): boolean {
  return /^[A-Z]{3,12}$/.test(word);
}

/**
 * Validation appliquée aux mots saisis par le MSP (file d'attente + override
 * du mot du jour) : même dictionnaire que les propositions des joueurs
 * (`submitGuess`), sans l'exception qui laisse passer le mot du jour lui-même
 * (elle n'a pas de sens ici, puisque c'est justement CE mot qu'on valide).
 */
function assertRealWord(word: string): void {
  if (!isValidWord(word)) {
    throw Object.assign(
      new Error('Le mot doit contenir entre 3 et 12 lettres, sans accents ni espaces'),
      { status: 400 }
    );
  }
  if (!isDictionaryWord(word)) {
    throw Object.assign(new Error('Ce mot n’existe pas dans le dictionnaire'), { status: 400 });
  }
}

function pickRandomWord(): string {
  const index = Math.floor(Math.random() * WORD_DICTIONARY.length);
  return WORD_DICTIONARY[index] as string;
}

/**
 * Algorithme Wordle en deux passes : les lettres bien placées sont retirées
 * du décompte AVANT de chercher les lettres présentes mais mal placées —
 * indispensable pour gérer les doublons (ex: réponse "ETOILE", proposition
 * "ELIMEE" ne doit pas marquer les deux 'E' comme "présent" si un seul est
 * réellement disponible après les lettres déjà bien placées).
 */
function evaluateGuess(guess: string, answer: string): MotusLetterState[] {
  const n = answer.length;
  const result: MotusLetterState[] = new Array(n).fill('absent');
  const remaining: Record<string, number> = {};

  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      const letter = answer[i] as string;
      remaining[letter] = (remaining[letter] ?? 0) + 1;
    }
  }

  for (let i = 0; i < n; i++) {
    if (result[i] === 'correct') continue;
    const letter = guess[i] as string;
    if ((remaining[letter] ?? 0) > 0) {
      result[i] = 'present';
      remaining[letter] = (remaining[letter] as number) - 1;
    }
  }

  return result;
}

/**
 * Récupère le mot du jour (date locale Europe/Paris), le créant s'il
 * n'existe pas encore : pioche le plus ancien mot en file MSP (FIFO,
 * `FOR UPDATE SKIP LOCKED` pour ne jamais réclamer deux fois le même mot en
 * cas d'appel concurrent), sinon tire un mot au hasard dans le dictionnaire.
 * `ON CONFLICT (word_date) DO NOTHING` + relecture gère la course entre deux
 * premières requêtes du jour : la perdante annule sa réclamation de file
 * (ROLLBACK la restaure à `used_at = NULL`) puis relit le mot déjà créé.
 */
export async function getOrCreateDailyWord(seasonId: number | null): Promise<MotusDailyWordRow> {
  const dateStr = todayLocal();
  const { rows: existing } = await pool.query<MotusDailyWordRow>(
    'SELECT * FROM motus_daily_words WHERE word_date = $1',
    [dateStr]
  );
  if (existing[0]) return existing[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: claimed } = await client.query<MotusWordQueueRow>(
      `UPDATE motus_word_queue SET used_at = NOW()
       WHERE id = (
         SELECT id FROM motus_word_queue WHERE used_at IS NULL
         ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    );
    const queueEntry = claimed[0] ?? null;
    const word = queueEntry ? queueEntry.word : pickRandomWord();

    const { rows: inserted } = await client.query<MotusDailyWordRow>(
      `INSERT INTO motus_daily_words (word_date, word, queue_id, season_id, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (word_date) DO NOTHING
       RETURNING *`,
      [dateStr, word, queueEntry?.id ?? null, seasonId, queueEntry ? 'queue' : 'random']
    );

    if (inserted[0]) {
      await client.query('COMMIT');
      return inserted[0];
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: fallback } = await pool.query<MotusDailyWordRow>(
    'SELECT * FROM motus_daily_words WHERE word_date = $1',
    [dateStr]
  );
  return fallback[0] as MotusDailyWordRow;
}

async function getMyAttempts(dailyWordId: number, userId: number): Promise<MotusAttemptRow[]> {
  const { rows } = await pool.query<MotusAttemptRow>(
    `SELECT * FROM motus_attempts WHERE daily_word_id = $1 AND user_id = $2 ORDER BY attempt_number ASC`,
    [dailyWordId, userId]
  );
  return rows;
}

function buildGameView(
  daily: MotusDailyWordRow,
  attempts: MotusAttemptRow[],
  maxAttempts: number,
  rewardSp: number
): MotusGameView {
  const won = attempts.some((a) => a.is_correct);
  const status: MotusGameStatus = won ? 'won' : attempts.length >= maxAttempts ? 'lost' : 'in_progress';
  return {
    wordDate: daily.word_date,
    wordLength: daily.word.length,
    maxAttempts,
    rewardSp,
    status,
    attempts,
    word: status === 'in_progress' ? null : daily.word,
  };
}

export async function getTodayView(userId: number, seasonId: number | null): Promise<MotusGameView> {
  const [daily, rewardSp, maxAttempts] = await Promise.all([
    getOrCreateDailyWord(seasonId),
    configService.getConfigNumber('motus_reward_sp', 5),
    configService.getConfigNumber('motus_max_attempts', 6),
  ]);
  const attempts = await getMyAttempts(daily.id, userId);
  return buildGameView(daily, attempts, maxAttempts, rewardSp);
}

export async function submitGuess(
  userId: number,
  seasonId: number | null,
  rawGuess: string
): Promise<MotusGameView> {
  const [daily, rewardSp, maxAttempts] = await Promise.all([
    getOrCreateDailyWord(seasonId),
    configService.getConfigNumber('motus_reward_sp', 5),
    configService.getConfigNumber('motus_max_attempts', 6),
  ]);

  const guess = normalizeWord(rawGuess);
  if (!/^[A-Z]+$/.test(guess)) {
    throw Object.assign(new Error('La proposition ne doit contenir que des lettres'), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou sur la ligne user : sérialise les soumissions concurrentes du
    // même joueur (deux onglets) pour que le calcul de attempt_number et la
    // vérification "déjà trouvé / plus de tentatives" restent cohérents.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    // Verrou sur le mot du jour lui-même : mutuellement exclusif avec
    // overrideTodayWord (même ligne verrouillée là-bas) pour qu'un MSP ne
    // puisse jamais changer le mot pendant qu'une tentative est en train
    // d'être enregistrée contre l'ancien — on relit le mot ICI, sous verrou,
    // plutôt que de réutiliser la valeur chargée avant le début de la transaction.
    const { rows: lockedDaily } = await client.query<MotusDailyWordRow>(
      'SELECT * FROM motus_daily_words WHERE id = $1 FOR UPDATE',
      [daily.id]
    );
    const currentWord = (lockedDaily[0] as MotusDailyWordRow).word;

    if (guess.length !== currentWord.length) {
      throw Object.assign(new Error(`Le mot du jour fait ${currentWord.length} lettres`), { status: 400 });
    }

    // Le mot du jour lui-même est toujours accepté même s'il n'est pas dans le
    // dictionnaire standard (ex : mot ajouté par le MSP via la file/override) —
    // sinon une partie deviendrait improuvable.
    if (guess !== currentWord && !isDictionaryWord(guess)) {
      throw Object.assign(new Error('Ce mot n’existe pas dans le dictionnaire'), { status: 400 });
    }

    const { rows: existingAttempts } = await client.query<MotusAttemptRow>(
      `SELECT * FROM motus_attempts WHERE daily_word_id = $1 AND user_id = $2 ORDER BY attempt_number ASC`,
      [daily.id, userId]
    );
    if (existingAttempts.some((a) => a.is_correct)) {
      throw Object.assign(new Error('Tu as déjà trouvé le mot du jour'), { status: 400 });
    }
    if (existingAttempts.length >= maxAttempts) {
      throw Object.assign(new Error('Plus de tentatives disponibles aujourd’hui'), { status: 400 });
    }

    const resultLetters = evaluateGuess(guess, currentWord);
    const isCorrect = guess === currentWord;
    const attemptNumber = existingAttempts.length + 1;

    const { rows: insertedRows } = await client.query<MotusAttemptRow>(
      `INSERT INTO motus_attempts (daily_word_id, user_id, attempt_number, guess, result, is_correct)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [daily.id, userId, attemptNumber, guess, JSON.stringify(resultLetters), isCorrect]
    );
    const attempt = insertedRows[0] as MotusAttemptRow;

    if (isCorrect && rewardSp > 0) {
      await spService.creditSP({
        userId,
        amount: rewardSp,
        type: 'motus_reward',
        seasonId,
        relatedId: daily.id,
        note: `Motus — mot du jour trouvé en ${attemptNumber}/${maxAttempts}`,
        client,
      });
    }

    await client.query('COMMIT');

    return buildGameView(
      { ...daily, word: currentWord },
      [...existingAttempts, attempt],
      maxAttempts,
      rewardSp
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listPendingQueue(): Promise<MotusWordQueueRow[]> {
  const { rows } = await pool.query<MotusWordQueueRow>(
    `SELECT * FROM motus_word_queue WHERE used_at IS NULL ORDER BY position ASC`
  );
  return rows;
}

export async function addQueueWord(rawWord: string, addedBy: number): Promise<MotusWordQueueRow> {
  const word = normalizeWord(rawWord);
  assertRealWord(word);
  // Ajouté en fin de file : la prochaine position libre parmi les mots en
  // attente (le MAX ignore les mots déjà consommés, qui gardent leur ancienne
  // position sans jamais entrer en collision avec les nouvelles puisqu'ils
  // sont exclus de tout futur tri par position).
  const { rows } = await pool.query<MotusWordQueueRow>(
    `INSERT INTO motus_word_queue (word, added_by, position)
     SELECT $1, $2, COALESCE(MAX(position), -1) + 1 FROM motus_word_queue WHERE used_at IS NULL
     RETURNING *`,
    [word, addedBy]
  );
  return rows[0] as MotusWordQueueRow;
}

export async function removeQueueWord(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM motus_word_queue WHERE id = $1 AND used_at IS NULL`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Échange la position du mot `id` avec son voisin immédiat (haut/bas de la
 * file affichée) — verrouille l'ensemble des mots en attente (`FOR UPDATE`)
 * pour que deux réorganisations concurrentes ne produisent jamais un
 * classement incohérent. No-op silencieux si le mot est déjà en tête/fin
 * (l'UI désactive déjà le bouton correspondant dans ce cas).
 */
export async function reorderQueueWord(
  id: number,
  direction: 'up' | 'down'
): Promise<MotusWordQueueRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: pending } = await client.query<MotusWordQueueRow>(
      `SELECT * FROM motus_word_queue WHERE used_at IS NULL ORDER BY position ASC FOR UPDATE`
    );
    const index = pending.findIndex((w) => w.id === id);
    if (index === -1) {
      throw Object.assign(new Error('Mot introuvable ou déjà utilisé'), { status: 404 });
    }

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= pending.length) {
      await client.query('ROLLBACK');
      return pending;
    }

    const a = pending[index] as MotusWordQueueRow;
    const b = pending[swapIndex] as MotusWordQueueRow;
    await client.query('UPDATE motus_word_queue SET position = $1 WHERE id = $2', [b.position, a.id]);
    await client.query('UPDATE motus_word_queue SET position = $1 WHERE id = $2', [a.position, b.id]);

    await client.query('COMMIT');

    const updated = pending.map((w) => {
      if (w.id === a.id) return { ...w, position: b.position };
      if (w.id === b.id) return { ...w, position: a.position };
      return w;
    });
    updated.sort((x, y) => x.position - y.position);
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listHistory(limit: number): Promise<MotusHistoryEntry[]> {
  const { rows } = await pool.query<MotusDailyWordRow>(
    `SELECT * FROM motus_daily_words ORDER BY word_date DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Vue MSP : toutes les soumissions de tous les joueurs, tous jours confondus,
 * les plus récentes d'abord — même principe que les réponses d'événement
 * (texte visible seulement par le MSP et l'auteur) sauf qu'ici c'est le MSP
 * qui consulte, donc aucune restriction de contenu à appliquer.
 */
export async function listRecentAttempts(limit: number): Promise<MotusAttemptHistoryEntry[]> {
  const { rows } = await pool.query<MotusAttemptHistoryEntry>(
    `SELECT a.*, u.username, d.word_date, d.word
     FROM motus_attempts a
     JOIN users u ON u.id = a.user_id
     JOIN motus_daily_words d ON d.id = a.daily_word_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getTodayAdminView(seasonId: number | null): Promise<MotusTodayAdminView> {
  const daily = await getOrCreateDailyWord(seasonId);
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM motus_attempts WHERE daily_word_id = $1',
    [daily.id]
  );
  return {
    wordDate: daily.word_date,
    word: daily.word,
    source: daily.source,
    attemptCount: Number(rows[0]?.count ?? 0),
  };
}

/**
 * Remplace le mot du jour déjà tiré — uniquement tant qu'aucune tentative n'a
 * encore été enregistrée (par n'importe quel joueur, admin inclus) pour ce
 * mot : au-delà, des tentatives déjà verrouillées en base référenceraient un
 * mot qui n'est plus le bon, cassant leur affichage et l'équité de la partie.
 * Si le mot remplacé venait de la file MSP, il y est remis disponible
 * (`used_at = NULL`) à sa position d'origine plutôt que d'être perdu.
 */
export async function overrideTodayWord(
  rawWord: string,
  seasonId: number | null
): Promise<MotusDailyWordRow> {
  const word = normalizeWord(rawWord);
  assertRealWord(word);

  const daily = await getOrCreateDailyWord(seasonId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Même verrou que submitGuess sur cette ligne : une tentative en train
    // d'être enregistrée doit se terminer (ou l'inverse) avant qu'on décide
    // s'il reste sûr de remplacer le mot — jamais les deux en même temps.
    await client.query('SELECT id FROM motus_daily_words WHERE id = $1 FOR UPDATE', [daily.id]);

    const { rows: countRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) FROM motus_attempts WHERE daily_word_id = $1',
      [daily.id]
    );
    if (Number(countRows[0]?.count ?? 0) > 0) {
      throw Object.assign(
        new Error('Impossible de modifier le mot : des joueurs ont déjà tenté leur chance aujourd’hui'),
        { status: 400 }
      );
    }

    if (daily.queue_id) {
      await client.query('UPDATE motus_word_queue SET used_at = NULL WHERE id = $1', [daily.queue_id]);
    }

    const { rows: updated } = await client.query<MotusDailyWordRow>(
      `UPDATE motus_daily_words SET word = $1, queue_id = NULL, source = 'manual'
       WHERE id = $2 RETURNING *`,
      [word, daily.id]
    );

    await client.query('COMMIT');
    return updated[0] as MotusDailyWordRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
