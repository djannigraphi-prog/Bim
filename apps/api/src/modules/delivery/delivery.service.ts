import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';

export type Channel = 'phone' | 'email';

export interface OutboundMessage {
  channel: Channel;
  destination: string;
  subject?: string;
  body: string;
  /** Uniquement pour les tests automatisés (fournisseur « test ») : jamais journalisé ni renvoyé par l'API. */
  code?: string;
  sentAt: Date;
}

/**
 * Point unique d'envoi des SMS et e-mails transactionnels (codes de vérification, alertes de sécurité).
 * Fournisseurs actuels :
 *  - console : écrit le message dans les journaux. Développement uniquement (refusé en staging/production par la config).
 *  - test    : conserve les messages en mémoire pour les tests automatisés.
 *  - none    : aucun envoi possible → l'API répond « non disponible ».
 * Les vrais fournisseurs (SMS ivoirien, Amazon SES) seront ajoutés derrière cette même interface (lot 2).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');
  /** Boîte d'envoi des tests (fournisseur « test » uniquement). */
  readonly testOutbox: OutboundMessage[] = [];

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  isAvailable(channel: Channel): boolean {
    return (channel === 'phone' ? this.cfg.SMS_PROVIDER : this.cfg.EMAIL_PROVIDER) !== 'none';
  }

  async sendCode(channel: Channel, destination: string, code: string, purpose: string): Promise<void> {
    const reason: Record<string, string> = {
      signup: 'pour activer ton compte',
      password_reset: 'pour réinitialiser ton mot de passe',
      contact_add: 'pour confirmer cette nouvelle coordonnée',
      step_up: 'pour confirmer une opération sensible',
      payout_number: 'pour confirmer le numéro Mobile Money de ta boutique',
    };
    const body = `BIM : ton code est ${code} ${reason[purpose] ?? ''}. Il expire dans ${Math.round(this.cfg.OTP_TTL_SECONDS / 60)} min. Ne le communique à personne.`;
    await this.send({ channel, destination, subject: 'Ton code BIM', body, code, sentAt: new Date() });
  }

  /**
   * Alerte de sécurité, envoyée après une opération déjà enregistrée : un canal indisponible ne doit ni transformer
   * la réussite en erreur, ni empêcher les alertes vers les autres coordonnées (audit, A-7). L'échec est journalisé.
   */
  async sendSecurityAlert(channel: Channel, destination: string, body: string): Promise<void> {
    try {
      await this.send({ channel, destination, subject: 'Alerte de sécurité BIM', body, sentAt: new Date() });
    } catch (e) {
      this.logger.error(`Alerte de sécurité non envoyée (${channel}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async send(msg: OutboundMessage): Promise<void> {
    const provider = msg.channel === 'phone' ? this.cfg.SMS_PROVIDER : this.cfg.EMAIL_PROVIDER;
    switch (provider) {
      case 'test':
        this.testOutbox.push(msg);
        return;
      case 'console':
        this.logger.warn(`[ENVOI FACTICE ${msg.channel}] → ${msg.destination} : ${msg.body}`);
        return;
      case 'none':
        throw Errors.notConfigured(msg.channel === 'phone' ? "L'envoi de SMS" : "L'envoi d'e-mails");
    }
  }
}
