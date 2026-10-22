import { SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Recherche sans tenir compte des accents ni de la casse : « kone » trouve « Koné » (extension PostgreSQL
 * « unaccent », migration 0064). Le motif est un motif ILIKE déjà échappé.
 */
export function foldedILike(column: AnyPgColumn | SQL, pattern: string): SQL {
  return sql`unaccent(${column}) ILIKE unaccent(${pattern}::text)`;
}

/** Texte saisi mis sous une forme unique (NFC) : un « é » composé de deux caractères devient un seul caractère. */
export const searchText = (q: string) => q.normalize('NFC').trim();
