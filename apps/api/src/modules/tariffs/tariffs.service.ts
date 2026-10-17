import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { communes, deliveryDurations, deliveryTariffs, shops } from '../../database/schema';
import type { AdminContext } from '../admin/admin.decorators';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { communeCode, DELIVERY_MODES, deliveryFee, DeliveryMode, TariffValues } from './pricing';

type Tariff = typeof deliveryTariffs.$inferSelect;

/** Devis d'un mode : disponible avec le détail du calcul, ou indisponible avec un motif (jamais d'estimation inventée). */
export type ModeQuote =
  | {
      mode: DeliveryMode;
      available: true;
      minutes: number;
      feeFcfa: number;
      tariffId: string;
      tariffVersion: number;
      breakdown: TariffValues;
      waitFeesBilled: boolean;
    }
  | { mode: DeliveryMode; available: false; reason: 'NO_TARIFF' | 'NO_DURATION' | 'COMMUNE_UNKNOWN' };

const VALUE_KEYS: (keyof TariffValues)[] = ['baseFcfa', 'perMinuteFcfa', 'minimumFcfa', 'roundingFcfa', 'freeWaitMinutes', 'waitPerMinuteFcfa', 'waitCapMinutes'];

function values(t: Tariff): TariffValues {
  return Object.fromEntries(VALUE_KEYS.map((k) => [k, t[k]])) as unknown as TariffValues;
}

function checkValues(v: Partial<TariffValues>): TariffValues {
  const fields: Record<string, string[]> = {};
  for (const k of VALUE_KEYS) {
    const x = v[k];
    const min = k === 'roundingFcfa' ? 1 : 0;
    if (!Number.isInteger(x) || (x as number) < min || (x as number) > 1_000_000) fields[k] = [`Entier entre ${min} et 1 000 000.`];
  }
  if (Object.keys(fields).length) throw Errors.validation({ fields });
  return v as TariffValues;
}

/**
 * Lot 7-D — Référentiel des communes, durées estimées entre communes et grilles tarifaires versionnées (§7).
 * Chaque modification d'administration est journalisée (valeurs avant / après).
 */
@Injectable()
export class TariffsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private log(a: AdminContext, meta: RequestMeta, action: string, targetId: string | undefined, metadata: Record<string, unknown>, tx?: DbOrTx) {
    return this.audit.log({ actorType: 'admin', actorId: a.adminId, action, targetType: 'delivery_tariff', targetId, ip: meta.ip, userAgent: meta.userAgent, metadata }, tx);
  }

  // ------------------------------------------------------------------ Communes

  async listCommunes(includeInactive = false) {
    const rows = await this.db
      .select()
      .from(communes)
      .where(includeInactive ? undefined : eq(communes.active, true))
      .orderBy(asc(communes.city), asc(communes.name));
    return { items: rows.map((c) => ({ code: c.code, city: c.city, name: c.name, active: c.active })) };
  }

  async createCommune(a: AdminContext, city: string, name: string, meta: RequestMeta) {
    const code = communeCode(city, name);
    if (!code.includes('-') || code.startsWith('-')) throw Errors.validation({ fields: { name: ['Ville et commune obligatoires.'] } });
    const inserted = await this.db.insert(communes).values({ code, city: city.trim(), name: name.trim() }).onConflictDoNothing().returning();
    if (!inserted.length) throw Errors.conflict('CODE_TAKEN', 'Cette commune existe déjà.');
    await this.log(a, meta, 'admin.commune_created', undefined, { code, city: city.trim(), name: name.trim() });
    return this.listCommunes(true);
  }

  async setCommuneActive(a: AdminContext, code: string, active: boolean, meta: RequestMeta) {
    const [c] = await this.db.update(communes).set({ active }).where(eq(communes.code, code)).returning();
    if (!c) throw Errors.notFound('Commune');
    await this.log(a, meta, 'admin.commune_updated', undefined, { code, active });
    return this.listCommunes(true);
  }

  /** Commune desservable d'une boutique (ville et commune saisies à l'ouverture), ou null. */
  async shopCommune(shopId: string, tx: DbOrTx = this.db): Promise<string | null> {
    const [s] = await tx.select({ city: shops.city, commune: shops.commune }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!s?.city || !s.commune) return null;
    const code = communeCode(s.city, s.commune);
    const [c] = await tx.select({ code: communes.code }).from(communes).where(and(eq(communes.code, code), eq(communes.active, true))).limit(1);
    return c?.code ?? null;
  }

  // ------------------------------------------------------------------ Durées

  async listDurations() {
    const rows = await this.db.select().from(deliveryDurations).orderBy(asc(deliveryDurations.fromCode), asc(deliveryDurations.toCode), asc(deliveryDurations.mode));
    return { items: rows.map((d) => ({ fromCode: d.fromCode, toCode: d.toCode, mode: d.mode, minutes: d.minutes, updatedAt: d.updatedAt })) };
  }

  /** Fixe (ou retire, `minutes = null`) la durée estimée d'un trajet pour un mode. */
  async setDuration(a: AdminContext, fromCode: string, toCode: string, mode: DeliveryMode, minutes: number | null, meta: RequestMeta) {
    for (const [field, code] of [['fromCode', fromCode], ['toCode', toCode]] as const) {
      const [c] = await this.db.select({ code: communes.code }).from(communes).where(eq(communes.code, code)).limit(1);
      if (!c) throw Errors.validation({ fields: { [field]: ['Commune inconnue.'] } });
    }
    await this.db.transaction(async (tx) => {
      const key = and(eq(deliveryDurations.fromCode, fromCode), eq(deliveryDurations.toCode, toCode), eq(deliveryDurations.mode, mode));
      const [before] = await tx.select({ minutes: deliveryDurations.minutes }).from(deliveryDurations).where(key).for('update').limit(1);
      if (minutes === null) await tx.delete(deliveryDurations).where(key);
      else
        await tx
          .insert(deliveryDurations)
          .values({ fromCode, toCode, mode, minutes, updatedBy: a.adminId })
          .onConflictDoUpdate({ target: [deliveryDurations.fromCode, deliveryDurations.toCode, deliveryDurations.mode], set: { minutes, updatedBy: a.adminId, updatedAt: new Date() } });
      await this.log(a, meta, 'admin.delivery_duration_set', undefined, { fromCode, toCode, mode, before: before?.minutes ?? null, after: minutes }, tx);
    });
    return this.listDurations();
  }

  // ------------------------------------------------------------------ Grilles

  private view(t: Tariff) {
    return { id: t.id, mode: t.mode, version: t.version, status: t.status, ...values(t), createdAt: t.createdAt, publishedAt: t.publishedAt };
  }

  async listTariffs() {
    const rows = await this.db.select().from(deliveryTariffs).orderBy(asc(deliveryTariffs.mode), desc(deliveryTariffs.version));
    const current: Record<string, string | null> = {};
    for (const m of DELIVERY_MODES) current[m] = (await this.current(m))?.id ?? null;
    return { items: rows.map((t) => ({ ...this.view(t), current: current[t.mode] === t.id })) };
  }

  /** Crée ou modifie le brouillon du mode (une seule version en brouillon par mode). */
  async saveDraft(a: AdminContext, mode: DeliveryMode, input: Partial<TariffValues>, meta: RequestMeta) {
    const v = checkValues(input);
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delivery_tariffs:${mode}`}))`);
      const [draft] = await tx.select().from(deliveryTariffs).where(and(eq(deliveryTariffs.mode, mode), eq(deliveryTariffs.status, 'draft'))).limit(1);
      if (draft) {
        await tx.update(deliveryTariffs).set(v).where(eq(deliveryTariffs.id, draft.id));
        await this.log(a, meta, 'admin.delivery_tariff_draft_updated', draft.id, { mode, version: draft.version, before: values(draft), after: v }, tx);
        return draft.id;
      }
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${deliveryTariffs.version}), 0)::int` }).from(deliveryTariffs).where(eq(deliveryTariffs.mode, mode));
      const nid = uuidv7();
      await tx.insert(deliveryTariffs).values({ id: nid, mode, version: max + 1, ...v, createdBy: a.adminId });
      await this.log(a, meta, 'admin.delivery_tariff_draft_created', nid, { mode, version: max + 1, after: v }, tx);
      return nid;
    });
    return this.view((await this.db.select().from(deliveryTariffs).where(eq(deliveryTariffs.id, id)))[0]);
  }

  /** Publie un brouillon : il devient la grille en vigueur du mode, immuable (déclencheur de la base). */
  async publish(a: AdminContext, id: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(deliveryTariffs).where(eq(deliveryTariffs.id, id)).for('update').limit(1);
      if (!t) throw Errors.notFound('Grille');
      if (t.status !== 'draft') throw Errors.conflict('TARIFF_ALREADY_PUBLISHED', 'Cette grille est déjà publiée ; crée une nouvelle version.');
      const previous = await this.current(t.mode as DeliveryMode, tx);
      await tx.update(deliveryTariffs).set({ status: 'published', publishedAt: new Date(), publishedBy: a.adminId }).where(eq(deliveryTariffs.id, id));
      await this.log(a, meta, 'admin.delivery_tariff_published', id, { mode: t.mode, version: t.version, values: values(t), replaces: previous ? { id: previous.id, version: previous.version, values: values(previous) } : null }, tx);
    });
    return this.listTariffs();
  }

  async deleteDraft(a: AdminContext, id: string, meta: RequestMeta) {
    const [t] = await this.db.delete(deliveryTariffs).where(and(eq(deliveryTariffs.id, id), eq(deliveryTariffs.status, 'draft'))).returning();
    if (!t) throw Errors.notFound('Brouillon');
    await this.log(a, meta, 'admin.delivery_tariff_draft_deleted', id, { mode: t.mode, version: t.version });
    return this.listTariffs();
  }

  /** Grille en vigueur d'un mode : sa dernière version publiée. */
  async current(mode: DeliveryMode, tx: DbOrTx = this.db): Promise<Tariff | null> {
    const [t] = await tx
      .select()
      .from(deliveryTariffs)
      .where(and(eq(deliveryTariffs.mode, mode), eq(deliveryTariffs.status, 'published')))
      .orderBy(desc(deliveryTariffs.publishedAt), desc(deliveryTariffs.version))
      .limit(1);
    return t ?? null;
  }

  async byId(id: string, tx: DbOrTx = this.db): Promise<Tariff | null> {
    const [t] = await tx.select().from(deliveryTariffs).where(eq(deliveryTariffs.id, id)).limit(1);
    return t ?? null;
  }

  // ------------------------------------------------------------------ Devis

  async waitFeesBilled(): Promise<boolean> {
    return (await this.settings.get<boolean>('delivery.wait_fees_enabled'))?.value === true;
  }

  /** Devis d'un trajet pour un mode, calculé par le serveur à partir de la grille en vigueur et de la table des durées. */
  async quote(fromCode: string | null, toCode: string, mode: DeliveryMode, tx: DbOrTx = this.db): Promise<ModeQuote> {
    if (!fromCode) return { mode, available: false, reason: 'COMMUNE_UNKNOWN' };
    const [to] = await tx.select({ code: communes.code }).from(communes).where(and(eq(communes.code, toCode), eq(communes.active, true))).limit(1);
    if (!to) return { mode, available: false, reason: 'COMMUNE_UNKNOWN' };
    const t = await this.current(mode, tx);
    if (!t) return { mode, available: false, reason: 'NO_TARIFF' };
    const [d] = await tx
      .select({ minutes: deliveryDurations.minutes })
      .from(deliveryDurations)
      .where(and(eq(deliveryDurations.fromCode, fromCode), eq(deliveryDurations.toCode, toCode), eq(deliveryDurations.mode, mode)))
      .limit(1);
    if (!d) return { mode, available: false, reason: 'NO_DURATION' };
    const breakdown = values(t);
    return { mode, available: true, minutes: d.minutes, feeFcfa: deliveryFee(breakdown, d.minutes), tariffId: t.id, tariffVersion: t.version, breakdown, waitFeesBilled: await this.waitFeesBilled() };
  }

  /**
   * L7-07 (décision du 17/10/2026) : les espèces en livraison ne sont possibles que si la boutique a au moins un livreur
   * **employé** actif (relation active, compte livreur actif) ; la course est alors réservée à ses employés.
   */
  async shopHasEmployeeCourier(shopId: string, tx: DbOrTx = this.db): Promise<boolean> {
    const r = await tx.execute<{ ok: number }>(sql`
      SELECT 1 AS ok FROM courier_shop_partnerships p JOIN courier_accounts c ON c.id = p.courier_id
      WHERE p.shop_id = ${shopId} AND p.relation = 'employee' AND p.status = 'active' AND c.status = 'active' LIMIT 1`);
    return r.rows.length > 0;
  }

  async quoteForShop(shopId: string, toCode: string) {
    const [s] = await this.db.select({ id: shops.id, status: shops.status }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!s || s.status !== 'active') throw Errors.notFound('Boutique');
    const from = await this.shopCommune(shopId);
    const cashOnDelivery = await this.shopHasEmployeeCourier(shopId);
    const quotes: ModeQuote[] = [];
    for (const m of DELIVERY_MODES) quotes.push(await this.quote(from, toCode, m));
    return { shopCommune: from, toCommune: toCode, cashOnDelivery, quotes };
  }

  /** Simulation pour l'administration : une grille (brouillon compris) appliquée à une durée. */
  async simulate(id: string, minutes: number) {
    const t = await this.byId(id);
    if (!t) throw Errors.notFound('Grille');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 2880) throw Errors.validation({ fields: { minutes: ['Entre 1 et 2880 minutes.'] } });
    return { tariffId: t.id, version: t.version, minutes, feeFcfa: deliveryFee(values(t), minutes) };
  }
}
