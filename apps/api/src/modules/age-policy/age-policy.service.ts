import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, Errors } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { ageOn } from './age';

/**
 * F15 — Restrictions d'âge appliquées séparément par capacité.
 * Les seuils viennent de app_settings (clés age.*), jamais du code ni de l'app mobile.
 * Seuil null = règle non décidée → la capacité est refusée avec le code RULE_NOT_DECIDED.
 */
export const AGE_CAPABILITIES = {
  registration: 'age.min_registration',
  coins_purchase: 'age.min_coins_purchase',
  coins_withdrawal: 'age.min_coins_withdrawal',
  paid_subscription: 'age.min_paid_subscription',
  other_payments: 'age.min_other_payments',
  merchant: 'age.min_merchant',
  courier: 'age.min_courier',
} as const;

export type AgeCapability = keyof typeof AGE_CAPABILITIES;

export interface CapabilityStatus {
  allowed: boolean;
  /** decided | provisional | pending — pending signifie que la règle n'est pas encore fixée. */
  ruleStatus: 'decided' | 'provisional' | 'pending';
  minAge: number | null;
}

@Injectable()
export class AgePolicyService {
  constructor(private readonly settings: SettingsService) {}

  async status(capability: AgeCapability, birthDate: string, now = new Date()): Promise<CapabilityStatus> {
    const setting = await this.settings.get<number | null>(AGE_CAPABILITIES[capability]);
    const minAge = typeof setting?.value === 'number' ? setting.value : null;
    if (minAge === null) return { allowed: false, ruleStatus: 'pending', minAge: null };
    return { allowed: ageOn(birthDate, now) >= minAge, ruleStatus: setting!.decisionStatus, minAge };
  }

  /** Lève une erreur si la capacité n'est pas autorisée pour cette date de naissance. */
  async assert(capability: AgeCapability, birthDate: string, now = new Date()): Promise<void> {
    const s = await this.status(capability, birthDate, now);
    if (s.ruleStatus === 'pending') throw Errors.ruleNotDecided(AGE_CAPABILITIES[capability]);
    if (!s.allowed) {
      throw new AppError(
        'AGE_REQUIREMENT_NOT_MET',
        capability === 'registration'
          ? `Tu dois avoir au moins ${s.minAge} ans pour créer un compte BIM.`
          : `Cette fonctionnalité est réservée aux personnes d'au moins ${s.minAge} ans.`,
        HttpStatus.FORBIDDEN,
        { capability, minAge: s.minAge },
      );
    }
  }

  async all(birthDate: string, now = new Date()): Promise<Record<AgeCapability, CapabilityStatus>> {
    const out = {} as Record<AgeCapability, CapabilityStatus>;
    for (const cap of Object.keys(AGE_CAPABILITIES) as AgeCapability[]) out[cap] = await this.status(cap, birthDate, now);
    return out;
  }
}
