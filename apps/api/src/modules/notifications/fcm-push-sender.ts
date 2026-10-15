import { createHash, createSign } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PushMessage, PushResult, PushSender, PushTarget } from './push-sender';

/**
 * Envoi par Firebase Cloud Messaging, API HTTP v1 (lot 2, étape E).
 *
 * Préparé mais **inactif** : il ne sert que si PUSH_PROVIDER=fcm et qu'un compte de service Firebase est fourni
 * (variable FCM_SERVICE_ACCOUNT_JSON, injectée depuis un secret AWS, jamais dans le dépôt). La création du projet
 * Firebase attend l'accord du fondateur. FCM est gratuit ; aucun SDK lourd : deux appels HTTPS (jeton OAuth, envoi).
 *
 * Remplaçable (R-01 bis) : il implémente la même interface PushSender que les autres modes.
 */

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FcmOptions {
  account: FcmServiceAccount;
  /** Adresse de l'API FCM (modifiable uniquement en développement, pour les tests avec un faux serveur). */
  apiBaseUrl?: string;
  /** Adresse d'obtention des jetons OAuth (idem). */
  tokenUrl?: string;
  timeoutMs?: number;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_API = 'https://fcm.googleapis.com';

/** Lit et vérifie le JSON du compte de service ; message clair sans jamais recopier la clé. */
export function parseServiceAccount(raw: string): FcmServiceAccount {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON n’est pas un JSON valide');
  }
  const a = v as Partial<FcmServiceAccount>;
  if (!a || typeof a.project_id !== 'string' || typeof a.client_email !== 'string' || typeof a.private_key !== 'string' || !a.private_key.includes('PRIVATE KEY')) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON doit contenir project_id, client_email et private_key');
  }
  return { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key, token_uri: a.token_uri };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Identifiant court et stable pour le regroupement à l'affichage (APNs limite apns-collapse-id à 64 octets). */
export function collapseId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export class FcmPushSender implements PushSender {
  readonly name = 'fcm';
  private readonly log = new Logger('FCM');
  private access: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;
  private readonly tokenUrl: string;
  private readonly sendUrl: string;

  constructor(private readonly opts: FcmOptions) {
    this.tokenUrl = opts.tokenUrl || opts.account.token_uri || DEFAULT_TOKEN_URL;
    this.sendUrl = `${opts.apiBaseUrl || DEFAULT_API}/v1/projects/${encodeURIComponent(opts.account.project_id)}/messages:send`;
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    try {
      let res = await this.post(await this.accessToken(), target, message);
      if (res.status === 401) {
        // Jeton OAuth expiré ou révoqué : on en redemande un, une seule fois.
        this.access = null;
        res = await this.post(await this.accessToken(), target, message);
      }
      return await this.interpret(res);
    } catch (e) {
      // Réseau, délai dépassé, jeton OAuth indisponible : passager, le worker réessaie plus tard.
      return { ok: false, permanent: false, reason: (e as { name?: string } | null)?.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  }

  private post(accessToken: string, target: PushTarget, m: PushMessage) {
    const id = collapseId(m.collapseKey);
    const body = {
      message: {
        token: target.token,
        notification: { title: m.title, body: m.body },
        data: m.data,
        android: { priority: 'HIGH', ttl: `${m.ttlSeconds}s`, notification: { tag: id, channel_id: 'reminders' } },
        apns: {
          headers: { 'apns-collapse-id': id, 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + m.ttlSeconds) },
          payload: { aps: { sound: 'default' } },
        },
      },
    };
    return fetch(this.sendUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
  }

  /**
   * Traduction des réponses FCM. Seuls les refus qui désignent sans ambiguïté le jeton (UNREGISTERED, SENDER_ID_MISMATCH)
   * retirent l'appareil : un 400 « INVALID_ARGUMENT » peut venir d'une erreur de notre message, et ne doit jamais
   * provoquer la suppression en masse des appareils ; il finit en échec visible dans la surveillance.
   */
  private async interpret(res: Response): Promise<PushResult> {
    if (res.ok) return { ok: true };
    const code = await errorCode(res);
    if (res.status === 404 || code === 'UNREGISTERED') return { ok: false, permanent: true, reason: 'unregistered' };
    if (code === 'SENDER_ID_MISMATCH') return { ok: false, permanent: true, reason: 'sender_id_mismatch' };
    if (res.status === 400) {
      this.log.warn({ msg: 'fcm.rejected', status: res.status, code });
      return { ok: false, permanent: false, reason: 'invalid_argument' };
    }
    if (res.status === 401 || res.status === 403) {
      this.log.error({ msg: 'fcm.auth', status: res.status, code });
      return { ok: false, permanent: false, reason: 'auth' };
    }
    return { ok: false, permanent: false, reason: res.status === 429 ? 'quota' : `http_${res.status}` };
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now()) return this.access.token;
    // Une seule demande à la fois, même si plusieurs envois partent en parallèle.
    this.pending ??= this.fetchAccessToken().finally(() => (this.pending = null));
    return this.pending;
  }

  private async fetchAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: this.opts.account.client_email, scope: SCOPE, aud: this.tokenUrl, iat: now, exp: now + 3600 }));
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.opts.account.private_key);
    const assertion = `${header}.${claims}.${b64url(signature)}`;
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) {
      this.log.error({ msg: 'fcm.oauth_failed', status: res.status });
      throw new Error(`OAuth ${res.status}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('OAuth : jeton absent');
    // Marge de 5 minutes avant l'expiration annoncée.
    this.access = { token: json.access_token, expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000 };
    return json.access_token;
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const json = (await res.json()) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } };
    return json.error?.details?.find((d) => d.errorCode)?.errorCode ?? json.error?.status;
  } catch {
    return undefined;
  }
}
