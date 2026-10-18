import { AnyColumn, SQL, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { postComments, posts, reels, users } from '../../database/schema';

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

/** Lot 11 : mêmes règles pour un Reel (publié, auteur actif, public ou abonnés suivis, aucun blocage). Joindre `users`. */
export function reelVisibleTo(viewerId: string): SQL {
  return sql`(${reels.status} = 'published' AND ${users.status} = 'active' AND (
      ${reels.userId} = ${viewerId}
      OR ${reels.visibility} = 'public'
      OR (${reels.visibility} = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = ${reels.userId}))
    ) AND ${notBlockedBetween(viewerId, reels.userId)})`;
}

/** Aucun blocage, dans un sens ou dans l'autre, entre `viewerId` et la personne de la colonne `other`. */
export function notBlockedBetween(viewerId: string, other: SQL | AnyColumn): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${other}) OR (b.blocker_id = ${other} AND b.blocked_id = ${viewerId}))`;
}

/**
 * Un commentaire n'existe pour les autres que si son parent (pour une réponse) est lui aussi publié : les réponses
 * d'un commentaire masqué ou supprimé ne sont ni affichées, ni comptées, ni notifiées, ni actionnables (audit, défaut 3).
 */
export function commentParentPublished(): SQL {
  return sql`(${postComments.parentId} IS NULL OR EXISTS (SELECT 1 FROM post_comments pc WHERE pc.id = ${postComments.parentId} AND pc.status = 'published'))`;
}

/**
 * Recalcule le compteur de commentaires d'une publication à partir de la base, après un masquage, un
 * rétablissement ou une suppression : commentaires publiés dont le parent éventuel est publié.
 */
export async function recountComments(tx: Pick<Database, 'execute'>, postId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE posts SET comment_count = (
      SELECT count(*) FROM post_comments c
      WHERE c.post_id = ${postId} AND c.status = 'published'
        AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM post_comments pc WHERE pc.id = c.parent_id AND pc.status = 'published'))
    ) WHERE id = ${postId}`);
}

/** Un signalement ouvert existe sur ce contenu (audit du 18/10/2026 : on ne détruit pas une preuve). */
export async function openReport(db: Pick<Database, 'execute'>, targetType: string, targetId: string): Promise<boolean> {
  const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM content_reports WHERE target_type = ${targetType} AND target_id = ${targetId} AND status = 'open'`);
  return (r.rows[0]?.n ?? 0) > 0;
}
