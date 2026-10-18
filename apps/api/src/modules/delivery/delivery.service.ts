import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
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
 *  - smtp    : (e-mail, V1) envoi par SMTP chiffré, chez le fournisseur choisi par le fondateur (offre gratuite au
 *              lancement, payante plus tard : seul le réglage change). Le code n'est jamais journalisé.
 * Le SMS réel (fournisseur ivoirien ou Firebase) sera ajouté derrière cette même interface, après accord.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');
  /** Boîte d'envoi des tests (fournisseur « test » uniquement). */
  readonly testOutbox: OutboundMessage[] = [];
  /**
   * Démonstration sur un ordinateur (NODE_ENV=development et DEMO_MODE) : derniers messages factices, en mémoire
   * seulement, affichés sur la page /demo de l'ordinateur pour que la personne qui présente lise les codes.
   */
  readonly demoOutbox: Array<Omit<OutboundMessage, 'code'>> = [];

  get demoPageEnabled(): boolean {
    return this.cfg.NODE_ENV === 'development' && this.cfg.DEMO_MODE;
  }

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.mailer = cfg.EMAIL_PROVIDER === 'smtp' ? createTransport(cfg.SMTP_URL, { from: cfg.EMAIL_FROM }) : null;
  }

  private readonly mailer: Transporter | null;

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
        if (this.demoPageEnabled) {
          this.demoOutbox.unshift({ channel: msg.channel, destination: msg.destination, subject: msg.subject, body: msg.body, sentAt: msg.sentAt });
          this.demoOutbox.length = Math.min(this.demoOutbox.length, 30);
        }
        return;
      case 'smtp':
        try {
          await this.mailer!.sendMail({ to: msg.destination, subject: msg.subject ?? 'BIM', text: msg.body });
        } catch (e) {
          // Jamais le contenu (il porte le code) ni l'adresse complète dans les journaux.
          this.logger.error(`E-mail non envoyé : ${e instanceof Error ? e.name : 'erreur'}`);
          throw Errors.notConfigured("L'envoi d'e-mails");
        }
        return;
      case 'none':
        throw Errors.notConfigured(msg.channel === 'phone' ? "L'envoi de SMS" : "L'envoi d'e-mails");
    }
  }
}
