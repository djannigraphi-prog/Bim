import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { interests, privacySettings, userContacts, userInterests, userPreferences, users } from '../../database/schema';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { SettingsService } from '../settings/settings.service';

export type ContactRow = typeof userContacts.$inferSelect;

/** Lecture du compte de la personne connectée et choix de la coordonnée de récupération (F16). */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly agePolicy: AgePolicyService,
  ) {}

  async findById(userId: string, tx: DbOrTx = this.db) {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  }

  async verifiedContacts(userId: string, tx: DbOrTx = this.db): Promise<ContactRow[]> {
    return tx
      .select()
      .from(userContacts)
      .where(and(eq(userContacts.userId, userId), isNotNull(userContacts.verifiedAt)))
      .orderBy(asc(userContacts.createdAt));
  }

  /** Canal privilégié (réglage auth.recovery_preferred_channel, le téléphone selon F16), sinon l'autre. */
  async preferredChannel(): Promise<'phone' | 'email'> {
    const s = await this.settings.get<string>('auth.recovery_preferred_channel');
    return s?.value === 'email' ? 'email' : 'phone';
  }

  async recoveryContact(userId: string, tx: DbOrTx = this.db): Promise<ContactRow | null> {
    const contacts = await this.verifiedContacts(userId, tx);
    const preferred = await this.preferredChannel();
    return contacts.find((c) => c.type === preferred) ?? contacts[0] ?? null;
  }

  /** Profil privé complet de la personne connectée (jamais exposé à un tiers). */
  async me(userId: string) {
    const user = await this.findById(userId);
    if (!user || user.status === 'deleted') throw Errors.notFound('Compte');
    const [contacts, myInterests, prefs, privacy] = await Promise.all([
      this.db.select().from(userContacts).where(eq(userContacts.userId, userId)).orderBy(asc(userContacts.createdAt)),
      this.db
        .select({ code: interests.code, label: interests.label })
        .from(userInterests)
        .innerJoin(interests, eq(interests.code, userInterests.interestCode))
        .where(eq(userInterests.userId, userId))
        .orderBy(asc(interests.sortOrder)),
      this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
      this.db.select().from(privacySettings).where(eq(privacySettings.userId, userId)).limit(1),
    ]);
    return {
      id: user.id,
      status: user.status,
      fullName: user.fullName,
      username: user.username,
      birthDate: user.birthDate,
      gender: user.gender,
      city: user.city,
      hasPassword: user.passwordHash !== null,
      contacts: contacts.map((c) => ({ id: c.id, type: c.type, value: c.value, verified: c.verifiedAt !== null })),
      interests: myInterests,
      preferences: { theme: prefs[0]?.theme ?? 'system', language: prefs[0]?.language ?? 'fr' },
      privacy: {
        birthDatePublic: privacy[0]?.birthDatePublic ?? false,
        genderPublic: privacy[0]?.genderPublic ?? false,
        cityPublic: privacy[0]?.cityPublic ?? false,
      },
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Capacités liées à l'âge (F15), calculées par le serveur ; l'app affiche, elle ne décide pas. */
  async capabilities(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw Errors.notFound('Compte');
    return { age: await this.agePolicy.all(user.birthDate) };
  }

  async updatePreferences(userId: string, theme?: 'system' | 'light' | 'dark') {
    if (theme) {
      await this.db
        .insert(userPreferences)
        .values({ userId, theme })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { theme, updatedAt: new Date() } });
    }
    const rows = await this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    return { theme: rows[0]?.theme ?? 'system', language: rows[0]?.language ?? 'fr' };
  }

  assertActive(user: { status: string } | null): asserts user {
    if (!user || user.status === 'deleted') throw Errors.notFound('Compte');
    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'Ce compte est suspendu. Contacte le support BIM.', HttpStatus.FORBIDDEN);
  }
}
