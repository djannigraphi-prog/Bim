import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, SQL } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import {
  adminLoginChallenges,
  adminRoles,
  adminSessions,
  adminUserRoles,
  adminUsers,
  appSettings,
  auditLogs,
  programTemplates,
  programTemplateTasks,
  projectCategories,
  projectGoals,
  userContacts,
  users,
} from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { SettingsService } from '../settings/settings.service';
import type { AdminContext } from './admin.decorators';
import { validateSettingValue } from './setting-rules';

type DecisionStatus = 'decided' | 'provisional' | 'pending';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  private log(a: AdminContext, meta: RequestMeta, action: string, targetType?: string, targetId?: string, metadata: Record<string, unknown> = {}, tx?: Parameters<AuditService['log']>[1]) {
    return this.audit.log({ actorType: 'admin', actorId: a.adminId, action, targetType, targetId, ip: meta.ip, userAgent: meta.userAgent, metadata }, tx);
  }

  // ------------------------------------------------------------------ Réglages (app_settings)

  async listSettings() {
    const rows = await this.db.select().from(appSettings).orderBy(asc(appSettings.key));
    return { items: rows.map((r) => ({ key: r.key, value: r.value, description: r.description, decisionStatus: r.decisionStatus, decisionRef: r.decisionRef, updatedAt: r.updatedAt, updatedBy: r.updatedBy })) };
  }

  /** Modifie un réglage existant (jamais de création libre) ; la valeur est contrôlée selon la règle de la clé. */
  async updateSetting(a: AdminContext, key: string, body: { value: unknown; decisionStatus?: DecisionStatus; decisionRef?: string | null }, meta: RequestMeta) {
    const [current] = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    if (!current) throw Errors.notFound('Réglage');
    const problem = validateSettingValue(key, body.value);
    if (problem) throw Errors.validation({ fields: { value: [problem] } });
    await this.db.transaction(async (tx) => {
      await tx
        .update(appSettings)
        .set({
          value: body.value as never,
          decisionStatus: body.decisionStatus ?? current.decisionStatus,
          decisionRef: body.decisionRef === undefined ? current.decisionRef : body.decisionRef,
          updatedAt: new Date(),
          updatedBy: a.email,
        })
        .where(eq(appSettings.key, key));
      await this.log(a, meta, 'admin.setting_updated', 'setting', undefined, { key, before: current.value, after: body.value, decisionStatus: body.decisionStatus ?? current.decisionStatus }, tx);
    });
    this.settings.invalidate(key);
    return (await this.listSettings()).items.find((s) => s.key === key);
  }

  // ------------------------------------------------------------------ Journal d'audit

  async listAudit(q: { action?: string; actorId?: string; targetId?: string; before?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const where: SQL[] = [];
    if (q.action) where.push(ilike(auditLogs.action, `${likeEscape(q.action)}%`));
    if (q.actorId) where.push(eq(auditLogs.actorId, q.actorId));
    if (q.targetId) where.push(eq(auditLogs.targetId, q.targetId));
    if (q.before) where.push(lt(auditLogs.createdAt, new Date(q.before)));
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
    return { items: rows, nextBefore: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null };
  }

  // ------------------------------------------------------------------ Utilisateurs

  async searchUsers(a: AdminContext, query: string, meta: RequestMeta) {
    const raw = query.trim().replace(/^@/, '');
    const q = likeEscape(raw);
    if (raw.length < 3) throw Errors.validation({ fields: { q: ['Au moins 3 caractères.'] } });
    const digits = raw.replace(/\D/g, '');
    const byContact = await this.db
      .selectDistinct({ userId: userContacts.userId })
      .from(userContacts)
      .where(digits.length >= 6 ? ilike(userContacts.value, `%${digits}%`) : ilike(userContacts.value, `${q.toLowerCase()}%`))
      .limit(20);
    const conditions: SQL[] = [ilike(users.username, `${q.toLowerCase()}%`), ilike(users.fullName, `%${q}%`)];
    if (byContact.length) conditions.push(inArray(users.id, byContact.map((r) => r.userId)));
    const rows = await this.db
      .select({ id: users.id, username: users.username, fullName: users.fullName, status: users.status, createdAt: users.createdAt })
      .from(users)
      .where(or(...conditions))
      .orderBy(asc(users.username))
      .limit(20);
    // Une recherche dans les données personnelles est journalisée (qui a cherché quoi).
    await this.log(a, meta, 'admin.users_searched', undefined, undefined, { query: raw, results: rows.length });
    return { items: rows };
  }

  async userDetail(a: AdminContext, userId: string, meta: RequestMeta) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Errors.notFound('Compte');
    const contacts = await this.db.select().from(userContacts).where(eq(userContacts.userId, userId));
    await this.log(a, meta, 'admin.user_viewed', 'user', userId);
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      status: u.status,
      city: u.city,
      createdAt: u.createdAt,
      // Coordonnées partiellement masquées : le support n'a pas besoin de la valeur complète pour aider.
      contacts: contacts.map((c) => ({ type: c.type, value: mask(c.type, c.value), verified: !!c.verifiedAt })),
    };
  }

  /** Suspension : le compte ne peut plus se connecter, toutes ses sessions sont fermées. Motif obligatoire. */
  async setUserStatus(a: AdminContext, userId: string, status: 'suspended' | 'active', reason: string, meta: RequestMeta) {
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Errors.notFound('Compte');
    const allowed = status === 'suspended' ? u.status === 'active' : u.status === 'suspended';
    if (!allowed) throw Errors.conflict('INVALID_STATUS', `Impossible : le compte est « ${u.status} ».`);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
      if (status === 'suspended') await this.sessions.revokeAllForUser(userId, 'admin_suspended', tx);
      await this.log(a, meta, status === 'suspended' ? 'admin.user_suspended' : 'admin.user_reactivated', 'user', userId, { reason }, tx);
    });
    return this.userDetail(a, userId, meta);
  }

  // ------------------------------------------------------------------ Programmes types (C7)

  async listPrograms() {
    const [tpls, tasks, cats, goals] = await Promise.all([
      this.db.select().from(programTemplates).orderBy(asc(programTemplates.categoryCode), desc(programTemplates.createdAt)),
      this.db.select().from(programTemplateTasks).orderBy(asc(programTemplateTasks.sortOrder)),
      this.db.select().from(projectCategories).orderBy(asc(projectCategories.sortOrder)),
      this.db.select().from(projectGoals).orderBy(asc(projectGoals.sortOrder)),
    ]);
    return {
      categories: cats.map((c) => ({ code: c.code, label: c.label, goals: goals.filter((g) => g.categoryCode === c.code).map((g) => ({ code: g.code, label: g.label })) })),
      items: tpls.map((t) => ({ ...t, tasks: tasks.filter((x) => x.templateId === t.id) })),
    };
  }

  async createProgram(a: AdminContext, body: ProgramInput, meta: RequestMeta) {
    await this.checkProgramRefs(body.categoryCode, body.goalCode ?? null);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(programTemplates).values({ id, categoryCode: body.categoryCode, goalCode: body.goalCode ?? null, title: body.title.trim(), durationDays: body.durationDays });
      if (body.tasks.length) await tx.insert(programTemplateTasks).values(body.tasks.map((t, i) => ({ id: uuidv7(), templateId: id, ...taskRow(t), sortOrder: i })));
      await this.log(a, meta, 'admin.program_created', 'program_template', id, { category: body.categoryCode }, tx);
    });
    return this.program(id);
  }

  /** Seul un brouillon se modifie : un programme publié est figé (les projets en cours en ont une copie). */
  async updateProgram(a: AdminContext, id: string, body: ProgramInput, meta: RequestMeta) {
    const t = await this.program(id);
    if (t.status !== 'draft') throw Errors.conflict('PROGRAM_NOT_DRAFT', 'Seul un brouillon peut être modifié. Archive-le et crée une nouvelle version.');
    await this.checkProgramRefs(body.categoryCode, body.goalCode ?? null);
    await this.db.transaction(async (tx) => {
      await tx
        .update(programTemplates)
        .set({ categoryCode: body.categoryCode, goalCode: body.goalCode ?? null, title: body.title.trim(), durationDays: body.durationDays, updatedAt: new Date() })
        .where(eq(programTemplates.id, id));
      await tx.delete(programTemplateTasks).where(eq(programTemplateTasks.templateId, id));
      if (body.tasks.length) await tx.insert(programTemplateTasks).values(body.tasks.map((x, i) => ({ id: uuidv7(), templateId: id, ...taskRow(x), sortOrder: i })));
      await this.log(a, meta, 'admin.program_updated', 'program_template', id, {}, tx);
    });
    return this.program(id);
  }

  /**
   * Publication : exige le nom de la personne compétente qui a validé le contenu (C7) et au moins une tâche.
   * Un seul programme publié par catégorie et objectif : l'ancien est archivé.
   */
  async publishProgram(a: AdminContext, id: string, validatedBy: string, meta: RequestMeta) {
    const t = await this.program(id);
    if (t.status !== 'draft') throw Errors.conflict('PROGRAM_NOT_DRAFT', 'Seul un brouillon peut être publié.');
    if (!t.tasks.length) throw Errors.validation({ fields: { tasks: ['Ajoute au moins une tâche avant de publier.'] } });
    await this.db.transaction(async (tx) => {
      const previous = await tx
        .select({ id: programTemplates.id, goalCode: programTemplates.goalCode })
        .from(programTemplates)
        .where(and(eq(programTemplates.categoryCode, t.categoryCode), eq(programTemplates.status, 'published')));
      const same = previous.filter((p) => p.goalCode === t.goalCode).map((p) => p.id);
      if (same.length) await tx.update(programTemplates).set({ status: 'archived', updatedAt: new Date() }).where(inArray(programTemplates.id, same));
      await tx.update(programTemplates).set({ status: 'published', validatedBy: validatedBy.trim(), updatedAt: new Date() }).where(eq(programTemplates.id, id));
      await this.log(a, meta, 'admin.program_published', 'program_template', id, { validatedBy: validatedBy.trim(), archived: same }, tx);
    });
    return this.program(id);
  }

  async archiveProgram(a: AdminContext, id: string, meta: RequestMeta) {
    const t = await this.program(id);
    if (t.status === 'archived') return t;
    await this.db.update(programTemplates).set({ status: 'archived', updatedAt: new Date() }).where(eq(programTemplates.id, id));
    await this.log(a, meta, 'admin.program_archived', 'program_template', id);
    return this.program(id);
  }

  private async program(id: string) {
    const [t] = await this.db.select().from(programTemplates).where(eq(programTemplates.id, id)).limit(1);
    if (!t) throw Errors.notFound('Programme');
    const tasks = await this.db.select().from(programTemplateTasks).where(eq(programTemplateTasks.templateId, id)).orderBy(asc(programTemplateTasks.sortOrder));
    return { ...t, tasks };
  }

  private async checkProgramRefs(categoryCode: string, goalCode: string | null) {
    const [c] = await this.db.select().from(projectCategories).where(eq(projectCategories.code, categoryCode)).limit(1);
    if (!c) throw Errors.validation({ fields: { categoryCode: ['Catégorie inconnue.'] } });
    if (goalCode) {
      const [g] = await this.db.select().from(projectGoals).where(eq(projectGoals.code, goalCode)).limit(1);
      if (!g || g.categoryCode !== categoryCode) throw Errors.validation({ fields: { goalCode: ["Cet objectif n'appartient pas à la catégorie."] } });
    }
  }

  // ------------------------------------------------------------------ Comptes d'administration

  async listAdmins() {
    const rows = await this.db.select().from(adminUsers).orderBy(asc(adminUsers.email));
    const roles = await this.db.select().from(adminUserRoles);
    return {
      roles: await this.db.select().from(adminRoles).orderBy(asc(adminRoles.code)),
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        status: r.status,
        totpEnabled: !!r.totpEnabledAt,
        lastLoginAt: r.lastLoginAt,
        roles: roles.filter((x) => x.adminId === r.id).map((x) => x.roleCode),
      })),
    };
  }

  /** Création d'un compte : mot de passe initial fourni hors de l'app ; la double authentification se configure à la première connexion. */
  async createAdmin(a: AdminContext, body: { email: string; fullName: string; password: string; roles: string[] }, meta: RequestMeta) {
    const weak = this.passwords.weakness(body.password);
    if (weak || body.password.length < 12) throw Errors.validation({ fields: { password: [weak ?? 'Au moins 12 caractères pour un compte d’administration.'] } });
    await this.checkRoles(body.roles);
    const id = uuidv7();
    const email = body.email.trim().toLowerCase();
    const [exists] = await this.db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    if (exists) throw Errors.conflict('ADMIN_EXISTS', 'Un compte d’administration existe déjà avec cet e-mail.');
    const passwordHash = await this.passwords.hash(body.password);
    await this.db.transaction(async (tx) => {
      await tx.insert(adminUsers).values({ id, email, fullName: body.fullName.trim(), passwordHash });
      await tx.insert(adminUserRoles).values(body.roles.map((r) => ({ adminId: id, roleCode: r })));
      await this.log(a, meta, 'admin.admin_created', 'admin', id, { roles: body.roles }, tx);
    });
    return (await this.listAdmins()).items.find((x) => x.id === id);
  }

  async updateAdmin(a: AdminContext, id: string, body: { roles?: string[]; status?: 'active' | 'disabled'; resetTotp?: boolean }, meta: RequestMeta) {
    const [target] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    if (!target) throw Errors.notFound('Compte d’administration');
    if (body.roles) await this.checkRoles(body.roles);
    if (id === a.adminId && (body.status === 'disabled' || (body.roles && !body.roles.includes('super_admin')))) {
      throw Errors.conflict('SELF_LOCKOUT', 'Tu ne peux pas retirer tes propres droits d’administrateur principal ni désactiver ton compte.');
    }
    await this.db.transaction(async (tx) => {
      if (body.roles) {
        await tx.delete(adminUserRoles).where(eq(adminUserRoles.adminId, id));
        await tx.insert(adminUserRoles).values(body.roles.map((r) => ({ adminId: id, roleCode: r })));
      }
      if (body.status) await tx.update(adminUsers).set({ status: body.status }).where(eq(adminUsers.id, id));
      if (body.resetTotp) await tx.update(adminUsers).set({ totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null }).where(eq(adminUsers.id, id));
      if (body.status === 'disabled' || body.resetTotp || body.roles) {
        await tx.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.adminId, id));
        // Les étapes de connexion en cours (dont les enrôlements) sont annulées.
        await tx.update(adminLoginChallenges).set({ consumedAt: new Date() }).where(and(eq(adminLoginChallenges.adminId, id), isNull(adminLoginChallenges.consumedAt)));
      }
      // Il doit toujours rester au moins un administrateur principal actif.
      const [{ n }] = await tx
        .select({ n: count() })
        .from(adminUserRoles)
        .innerJoin(adminUsers, eq(adminUsers.id, adminUserRoles.adminId))
        .where(and(eq(adminUserRoles.roleCode, 'super_admin'), eq(adminUsers.status, 'active')));
      if (n < 1) throw Errors.conflict('LAST_SUPER_ADMIN', 'Il doit rester au moins un administrateur principal actif.');
      await this.log(a, meta, 'admin.admin_updated', 'admin', id, { roles: body.roles, status: body.status, resetTotp: !!body.resetTotp }, tx);
    });
    return (await this.listAdmins()).items.find((x) => x.id === id);
  }

  private async checkRoles(roles: string[]) {
    const known = (await this.db.select({ code: adminRoles.code }).from(adminRoles)).map((r) => r.code);
    if (!roles.length || roles.some((r) => !known.includes(r))) throw Errors.validation({ fields: { roles: [`Rôles possibles : ${known.join(', ')}.`] } });
  }
}

export interface ProgramTaskInput {
  title: string;
  detail?: string;
  icon?: string;
  timeOfDay: string;
  weekdays: number;
}

export interface ProgramInput {
  categoryCode: string;
  goalCode?: string | null;
  title: string;
  durationDays: number;
  tasks: ProgramTaskInput[];
}

function taskRow(t: ProgramTaskInput) {
  return { title: t.title.trim(), detail: t.detail?.trim() || null, icon: t.icon ?? 'check', timeOfDay: t.timeOfDay, weekdays: t.weekdays };
}

function mask(type: 'phone' | 'email', value: string): string {
  if (type === 'phone') return value.length > 6 ? `${value.slice(0, 6)}••••${value.slice(-2)}` : '••••';
  const [name, domain] = value.split('@');
  return `${name.slice(0, 2)}•••@${domain ?? ''}`;
}

/** Échappe les jokers de LIKE (%, _ et \\) : la saisie est cherchée telle quelle. */
function likeEscape(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}
