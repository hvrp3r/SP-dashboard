import fs from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Dictionnaire de validation des propositions Motus — chargé une fois au
 * démarrage depuis `an-array-of-french-words` (~336k mots, avec accents et
 * formes composées). Normalisé pour matcher le format interne du jeu (voir
 * note en tête de 042_motus.sql) : accents retirés, majuscules, et on ne garde
 * que les entrées purement alphabétiques de 3 à 12 lettres (élimine au passage
 * les formes composées à tiret/apostrophe/espace, ex: "abaisse-langue").
 */
const require = createRequire(import.meta.url);

// Plage Unicode des diacritiques combinants (accents) une fois le mot décomposé en NFD.
const DIACRITICS_REGEX = /[̀-ͯ]/g;

function normalize(word: string): string {
  return word.normalize('NFD').replace(DIACRITICS_REGEX, '').toUpperCase();
}

function loadDictionary(): Set<string> {
  const path = require.resolve('an-array-of-french-words/index.json');
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8')) as string[];
  const words = new Set<string>();
  for (const entry of raw) {
    const normalized = normalize(entry);
    if (/^[A-Z]{3,12}$/.test(normalized)) {
      words.add(normalized);
    }
  }
  return words;
}

const DICTIONARY = loadDictionary();

export function isDictionaryWord(word: string): boolean {
  return DICTIONARY.has(word);
}
