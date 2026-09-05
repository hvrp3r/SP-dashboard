import type { Request, Response } from 'express';
import * as suggestionService from '../services/suggestion.service.js';
import * as notificationService from '../services/notification.service.js';
import type { SuggestionSort, SuggestionStatus, SuggestionType } from '../types.js';

const VALID_TYPES: SuggestionType[] = ['feature', 'bug'];
const VALID_STATUSES: SuggestionStatus[] = ['open', 'closed'];
const VALID_SORTS: SuggestionSort[] = ['top', 'new'];

interface CreateSuggestionBody {
  type?: string;
  title?: string;
  description?: string;
}

export async function createSuggestion(
  req: Request<{}, {}, CreateSuggestionBody>,
  res: Response
): Promise<void> {
  const type = req.body?.type;
  const title = req.body?.title?.trim();
  const description = req.body?.description?.trim();

  if (!type || !VALID_TYPES.includes(type as SuggestionType)) {
    res.status(400).json({ error: 'Type de suggestion invalide' });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'Le titre est requis' });
    return;
  }
  if (title.length > 200) {
    res.status(400).json({ error: 'Le titre ne doit pas dépasser 200 caractères' });
    return;
  }

  const suggestion = await suggestionService.createSuggestion({
    authorId: req.user!.id,
    type: type as SuggestionType,
    title,
    description: description || null,
  });

  const entry = await suggestionService.getSuggestionEntry(suggestion.id, req.user!.id);
  res.status(201).json(entry);
}

export async function listSuggestions(req: Request, res: Response): Promise<void> {
  const statusParam = req.query.status as string | undefined;
  if (statusParam && !VALID_STATUSES.includes(statusParam as SuggestionStatus)) {
    res.status(400).json({ error: 'Statut invalide' });
    return;
  }
  const sortParam = (req.query.sort as string | undefined) ?? 'top';
  if (!VALID_SORTS.includes(sortParam as SuggestionSort)) {
    res.status(400).json({ error: 'Tri invalide' });
    return;
  }

  const suggestions = await suggestionService.listSuggestions({
    viewerId: req.user!.id,
    status: statusParam as SuggestionStatus | undefined,
    sort: sortParam as SuggestionSort,
  });
  res.json(suggestions);
}

async function buildDetail(id: number, viewerId: number) {
  const entry = await suggestionService.getSuggestionEntry(id, viewerId);
  if (!entry) return null;
  const comments = await suggestionService.listComments(id);
  return { ...entry, comments };
}

export async function getSuggestion(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant de suggestion invalide' });
    return;
  }
  const detail = await buildDetail(id, req.user!.id);
  if (!detail) {
    res.status(404).json({ error: 'Suggestion introuvable' });
    return;
  }
  res.json(detail);
}

interface CastVoteBody {
  value?: number;
}

export async function castVote(
  req: Request<{ id: string }, {}, CastVoteBody>,
  res: Response
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant de suggestion invalide' });
    return;
  }
  const value = req.body?.value;
  if (value !== 1 && value !== -1) {
    res.status(400).json({ error: 'La valeur du vote doit être 1 (up) ou -1 (down)' });
    return;
  }
  const suggestion = await suggestionService.getSuggestionById(id);
  if (!suggestion) {
    res.status(404).json({ error: 'Suggestion introuvable' });
    return;
  }
  if (suggestion.status !== 'open') {
    res.status(400).json({ error: 'Cette suggestion est clôturée' });
    return;
  }

  const result = await suggestionService.castVote(id, req.user!.id, value);
  res.json(result);
}

interface AddCommentBody {
  body?: string;
}

export async function addComment(
  req: Request<{ id: string }, {}, AddCommentBody>,
  res: Response
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant de suggestion invalide' });
    return;
  }
  const body = req.body?.body?.trim();
  if (!body) {
    res.status(400).json({ error: 'Le commentaire est requis' });
    return;
  }

  const suggestion = await suggestionService.getSuggestionById(id);
  if (!suggestion) {
    res.status(404).json({ error: 'Suggestion introuvable' });
    return;
  }
  if (suggestion.status !== 'open') {
    res.status(400).json({ error: 'Cette suggestion est clôturée' });
    return;
  }

  await suggestionService.addComment(id, req.user!.id, body);

  if (suggestion.author_id && suggestion.author_id !== req.user!.id) {
    await notificationService.createNotification({
      userId: suggestion.author_id,
      type: 'suggestion_comment',
      message: `Nouveau commentaire sur ta suggestion « ${suggestion.title} »`,
      link: `/suggestions/${id}`,
    });
  }

  const detail = await buildDetail(id, req.user!.id);
  res.status(201).json(detail);
}

export async function closeSuggestion(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant de suggestion invalide' });
    return;
  }
  const suggestion = await suggestionService.getSuggestionById(id);
  if (!suggestion) {
    res.status(404).json({ error: 'Suggestion introuvable' });
    return;
  }
  if (suggestion.status !== 'open') {
    res.status(400).json({ error: 'Cette suggestion est déjà clôturée' });
    return;
  }

  await suggestionService.closeSuggestion(id, req.user!.id);

  if (suggestion.author_id && suggestion.author_id !== req.user!.id) {
    await notificationService.createNotification({
      userId: suggestion.author_id,
      type: 'suggestion_closed',
      message: `Ta suggestion « ${suggestion.title} » a été clôturée par le MSP`,
      link: `/suggestions/${id}`,
    });
  }

  const detail = await buildDetail(id, req.user!.id);
  res.json(detail);
}

export async function deleteSuggestion(
  req: Request<{ id: string }>,
  res: Response
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant de suggestion invalide' });
    return;
  }
  const deleted = await suggestionService.deleteSuggestion(id);
  if (!deleted) {
    res.status(404).json({ error: 'Suggestion introuvable' });
    return;
  }
  res.status(204).end();
}
