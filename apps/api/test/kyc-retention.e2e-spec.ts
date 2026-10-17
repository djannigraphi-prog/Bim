import { uuidv7 } from '../src/common/uuid';
import { StorageService } from '../src/modules/media/storage';
import { KycRetentionService } from '../src/modules/maintenance/kyc-retention.service';
import { Harness, registerAndActivate, startHarness } from './harness';

/**
 * Décision du 17/10/2026 (18 h 50) : pièces d'identité gardées tant que le compte existe, supprimées 365 jours après la
 * fermeture du compte. Les âges décidés sont aussi vérifiés ici (valeurs livrées par la migration 0046).
 */
describe('Conservation des pièces d’identité (e2e)', () => {
  let h: Harness;
  let kyc: KycRetentionService;
  let storage: StorageService;
  beforeAll(async () => {
    h = await startHarness();
    kyc = h.app.get(KycRetentionService);
    storage = h.app.get(StorageService);
    await h.pool.query("update app_settings set value = '365', decision_status = 'decided' where key = 'kyc.document_retention_days'");
    h.settings.invalidate();
  });
  afterAll(async () => h.close());

  it('décisions livrées par la migration 0046 : 16 ans pour commander, 18 pour une boutique et pour livrer, pièces 365 jours après la fermeture', async () => {
    // Lu dans la migration elle-même : d'autres suites modifient ces réglages pendant leurs essais.
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = `${__dirname}/../src/database/migrations`;
    const sqlText = readFileSync(`${dir}/${readdirSync(dir).find((f) => f.startsWith('0046_'))}`, 'utf8');
    expect(sqlText).toMatch(/SET value = '16', decision_status = 'decided'.*WHERE key = 'age\.min_other_payments'/);
    expect(sqlText).toMatch(/SET value = '18', decision_status = 'decided'.*WHERE key = 'age\.min_merchant'/);
    expect(sqlText).toMatch(/SET value = '18', decision_status = 'decided'.*WHERE key = 'age\.min_courier'/);
    expect(sqlText).toMatch(/SET value = '365', decision_status = 'decided'[\s\S]*WHERE key = 'kyc\.document_retention_days'/);
  });

  /** Une pièce (boutique ou livreur) pour une personne dont le compte est fermé depuis `closedDaysAgo` jours (null : actif). */
  async function document(kind: 'merchant' | 'courier', closedDaysAgo: number | null) {
    const u = await registerAndActivate(h);
    const key = `kyc/test/${uuidv7()}.bin`;
    await storage.put(key, Buffer.from('piece-chiffree'), 'application/octet-stream');
    if (kind === 'merchant') {
      const shopId = uuidv7();
      const appId = uuidv7();
      await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Boutique', $3, 'active', 'Abidjan')", [shopId, u.userId, `k-${shopId}`]);
      await h.pool.query("insert into merchant_applications (id, user_id, shop_id, status) values ($1, $2, $3, 'approved')", [appId, u.userId, shopId]);
      await h.pool.query("insert into merchant_documents (id, application_id, kind, storage_key, width, height, bytes) values ($1, $2, 'id_front', $3, 10, 10, 14)", [uuidv7(), appId, key]);
    } else {
      const cId = uuidv7();
      await h.pool.query("insert into courier_accounts (id, user_id, type, status) values ($1, $2, 'independent', 'active')", [cId, u.userId]);
      await h.pool.query("insert into courier_documents (id, courier_id, kind, storage_key, width, height, bytes) values ($1, $2, 'selfie', $3, 10, 10, 14)", [uuidv7(), cId, key]);
    }
    if (closedDaysAgo !== null) await h.pool.query(`update users set status = 'deleted', deleted_at = now() - interval '${closedDaysAgo} days' where id = $1`, [u.userId]);
    return key;
  }
  const exists = async (key: string) =>
    (await h.pool.query('select (select count(*) from merchant_documents where storage_key = $1) + (select count(*) from courier_documents where storage_key = $1) as n', [key])).rows[0].n > 0;

  it('compte fermé depuis plus d’un an : fichier et ligne supprimés ; compte actif ou fermé récemment : gardés ; journal sans donnée personnelle', async () => {
    const oldMerchant = await document('merchant', 400);
    const oldCourier = await document('courier', 366);
    const recent = await document('merchant', 100);
    const active = await document('courier', null);
    await h.pool.query("delete from maintenance_runs where job = 'kyc_retention'");
    const r = await kyc.runScheduled();
    expect(r.status).toBe('ok');
    expect(r.deleted).toBeGreaterThanOrEqual(2);
    expect(await exists(oldMerchant)).toBe(false);
    expect(await exists(oldCourier)).toBe(false);
    await expect(storage.read(oldMerchant)).rejects.toThrow();
    expect(await exists(recent)).toBe(true);
    expect(await exists(active)).toBe(true);
    expect((await storage.read(active)).toString()).toBe('piece-chiffree');
    const log = (await h.pool.query("select metadata from audit_logs where action = 'maintenance.kyc_retention' order by created_at desc limit 1")).rows[0].metadata;
    expect(Object.keys(log).sort()).toEqual(['deleted', 'retentionDays']);
    // Un seul passage par jour.
    expect((await kyc.runScheduled()).status).toBe('already_done');
  });

  it('durée non décidée : rien n’est supprimé', async () => {
    await h.pool.query("update app_settings set decision_status = 'pending' where key = 'kyc.document_retention_days'");
    h.settings.invalidate();
    try {
      const key = await document('courier', 800);
      await h.pool.query("delete from maintenance_runs where job = 'kyc_retention'");
      expect((await kyc.runScheduled()).status).toBe('not_configured');
      expect(await exists(key)).toBe(true);
    } finally {
      await h.pool.query("update app_settings set decision_status = 'decided' where key = 'kyc.document_retention_days'");
      h.settings.invalidate();
    }
  });
});
