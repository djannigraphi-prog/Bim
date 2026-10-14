import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../../database/database.module';
import { appSettings } from '../../database/schema';

export interface SettingValue<T> {
  value: T;
  decisionStatus: 'decided' | 'provisional' | 'pending';
}

/**
 * Lecture des réglages métier administrables (table app_settings), avec un cache court.
 * Une valeur absente ou null = règle non décidée : l'appelant doit garder la fonctionnalité fermée.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { at: number; value: SettingValue<unknown> | null }>();
  private readonly ttlMs = 30_000;

  constructor(@Inject(DB) private readonly db: Database) {}

  async get<T>(key: string): Promise<SettingValue<T> | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as SettingValue<T> | null;
    const rows = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    const value = rows[0]
      ? { value: rows[0].value as T, decisionStatus: rows[0].decisionStatus as SettingValue<T>['decisionStatus'] }
      : null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Vide le cache (tests, ou après une modification depuis l'administration). */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
