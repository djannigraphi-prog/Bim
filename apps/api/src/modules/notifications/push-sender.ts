/**
 * Interface d'envoi des notifications (règle R-01 bis : remplaçable sans toucher aux règles métier).
 * Implémentations : « none » (rien n'est envoyé), « test » (enregistré en mémoire, développement et tests),
 * « fcm » (Firebase Cloud Messaging, étape suivante ; désactivé tant que le projet Firebase n'est pas créé et validé).
 */

export interface PushTarget {
  deviceId: string;
  token: string;
  platform: 'android' | 'ios';
}

export interface PushMessage {
  title: string;
  body: string;
  /**
   * Clé de regroupement : deux envois de la même clé ne s'affichent qu'une fois sur le téléphone
   * (dernier rempart contre un doublon si un worker s'arrête entre l'envoi et son enregistrement).
   */
  collapseKey: string;
  data: Record<string, string>;
}

/** permanent = le jeton n'est plus valable (app désinstallée…) : l'appareil est retiré. */
export type PushResult = { ok: true } | { ok: false; permanent: boolean; reason: string };

export interface PushSender {
  readonly name: string;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export class DisabledPushSender implements PushSender {
  readonly name = 'none';
  async send(): Promise<PushResult> {
    return { ok: false, permanent: false, reason: 'not_configured' };
  }
}

/**
 * Envoi de test : enregistre les messages, et peut simuler des pannes (jeton invalide, erreur passagère) pour
 * vérifier la reprise, les doublons et la suppression des jetons. Interdit hors développement (configuration).
 */
export class RecordingPushSender implements PushSender {
  readonly name = 'test';
  readonly sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  /** Jetons à refuser définitivement. */
  readonly invalidTokens = new Set<string>();
  /** Par jeton : nombre d'échecs passagers à simuler avant de réussir. */
  readonly transientFailures = new Map<string, number>();

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    if (this.invalidTokens.has(target.token)) return { ok: false, permanent: true, reason: 'unregistered' };
    const left = this.transientFailures.get(target.token) ?? 0;
    if (left > 0) {
      this.transientFailures.set(target.token, left - 1);
      return { ok: false, permanent: false, reason: 'unavailable' };
    }
    this.sent.push({ target, message });
    return { ok: true };
  }

  reset() {
    this.sent.length = 0;
    this.invalidTokens.clear();
    this.transientFailures.clear();
  }
}
