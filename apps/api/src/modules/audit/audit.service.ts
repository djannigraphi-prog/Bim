import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { auditLogs } from '../../database/schema';

export interface AuditEntry {
  actorType: 'user' | 'admin' | 'system';
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Ne jamais y mettre de mot de passe, code, jeton ou coordonnée complète. */
  metadata?: Record<string, unknown>;
}

/** Journal d'audit des opérations sensibles. Accepte une transaction pour être écrit atomiquement avec l'opération. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async log(entry: AuditEntry, tx: DbOrTx = this.db): Promise<void> {
    await tx.insert(auditLogs).values({
      id: uuidv7(),
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}
