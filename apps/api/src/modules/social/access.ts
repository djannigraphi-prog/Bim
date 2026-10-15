import { AnyColumn, SQL, sql } from 'drizzle-orm';
import { posts, users } from '../../database/schema';

/**
 * Règles de visibilité du social (lot 4), écrites une seule fois et appliquées dans la requête SQL elle-même.
 *
 * Une publication est visible par `viewerId` si : elle est publiée (ni masquée par la modération, ni supprimée) ; son
 * auteur a un compte actif (ni suspendu, ni supprimé) ; elle est à lui, ou publique, ou réservée aux abonnés et il
 * suit l'auteur ; et aucun des deux n'a bloqué l'autre. Les requêtes doivent joindre `users` sur l'auteur.
 */
export function postVisibleTo(viewerId: string): SQL {
  return sql`(${posts.status} = 'published' AND ${users.status} = 'active' AND (
      ${posts.userId} = ${viewerId}
      OR ${posts.visibility} = 'public'
      OR (${posts.visibility} = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = ${posts.userId}))
    ) AND ${notBlockedBetween(viewerId, posts.userId)})`;
}

/** Aucun blocage, dans un sens ou dans l'autre, entre `viewerId` et la personne de la colonne `other`. */
export function notBlockedBetween(viewerId: string, other: SQL | AnyColumn): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${other}) OR (b.blocker_id = ${other} AND b.blocked_id = ${viewerId}))`;
}
