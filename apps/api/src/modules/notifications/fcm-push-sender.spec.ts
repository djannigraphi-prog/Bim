import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { collapseId, FcmPushSender, parseServiceAccount } from './fcm-push-sender';
import { PushMessage } from './push-sender';

/**
 * Envoi FCM testé contre un faux serveur local (aucun projet Firebase, aucun appel extérieur, aucun coût) :
 * jeton OAuth signé RS256 vérifié avec la clé publique, contenu du message, et traduction des réponses de FCM.
 */
describe('envoi Firebase Cloud Messaging (faux serveur)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  let server: Server;
  let base: string;
  let oauthCalls = 0;
  let sends: Array<{ auth: string; body: { message: Record<string, unknown> } }> = [];
  let revokeNextToken = false;
  let tokenSeq = 0;

  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const body = await read(req);
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.url === '/token') {
        oauthCalls += 1;
        const assertion = new URLSearchParams(body).get('assertion') ?? '';
        const [h, c, sig] = assertion.split('.');
        const valid = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url'));
        const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString());
        if (!valid || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging' || claims.iss !== 'bim@bim-test.iam.gserviceaccount.com') {
          return reply(400, { error: 'invalid_grant' });
        }
        tokenSeq += 1;
        return reply(200, { access_token: `at-${tokenSeq}`, expires_in: 3600 });
      }
      if (req.url === '/v1/projects/bim-test/messages:send') {
        const parsed = JSON.parse(body);
        const auth = req.headers.authorization ?? '';
        sends.push({ auth, body: parsed });
        if (revokeNextToken) {
          revokeNextToken = false;
          return reply(401, { error: { status: 'UNAUTHENTICATED' } });
        }
        const token = parsed.message.token as string;
        if (token === 'slow') return setTimeout(() => reply(200, {}), 1500);
        if (token === 'gone') return reply(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
        if (token === 'other-project') return reply(403, { error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } });
        if (token === 'bad') return reply(400, { error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } });
        if (token === 'busy') return reply(503, { error: { status: 'UNAVAILABLE' } });
        if (token === 'quota') return reply(429, { error: { status: 'RESOURCE_EXHAUSTED', details: [{ errorCode: 'QUOTA_EXCEEDED' }] } });
        return reply(200, { name: 'projects/bim-test/messages/1' });
      }
      reply(404, {});
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    sends = [];
  });

  const account = () => parseServiceAccount(JSON.stringify({ project_id: 'bim-test', client_email: 'bim@bim-test.iam.gserviceaccount.com', private_key: pem }));
  const sender = (timeoutMs?: number) => new FcmPushSender({ account: account(), apiBaseUrl: base, tokenUrl: `${base}/token`, timeoutMs });
  const target = (token: string) => ({ deviceId: 'd', token, platform: 'android' as const });
  const key = '7c1e0c1a-0000-4000-8000-000000000001|7c1e0c1a-0000-4000-8000-000000000002|2026-10-15|0';
  const msg: PushMessage = { title: 'Peni', body: 'C’est l’heure', collapseKey: key, ttlSeconds: 1500, data: { type: 'task_reminder', day: '2026-10-15' } };

  it('envoi réussi : jeton OAuth signé, message complet, regroupement court et durée de vie bornée', async () => {
    const s = sender();
    const before = oauthCalls;
    await expect(s.send(target('ok-1'), msg)).resolves.toEqual({ ok: true });
    expect(oauthCalls - before).toBe(1);
    const m = sends[0].body.message as {
      token: string;
      notification: unknown;
      data: unknown;
      android: { ttl: string; notification: { tag: string } };
      apns: { headers: Record<string, string> };
    };
    expect(sends[0].auth).toMatch(/^Bearer at-\d+$/);
    expect(m.token).toBe('ok-1');
    expect(m.notification).toEqual({ title: 'Peni', body: 'C’est l’heure' });
    expect(m.data).toEqual({ type: 'task_reminder', day: '2026-10-15' });
    expect(m.android.ttl).toBe('1500s');
    expect(m.android.notification.tag).toBe(collapseId(key));
    expect(m.apns.headers['apns-collapse-id']).toBe(collapseId(key));
    expect(Buffer.byteLength(collapseId(key))).toBeLessThanOrEqual(64);
    expect(collapseId(key)).toBe(collapseId(key)); // stable : un renvoi remplace l'affichage au lieu de s'empiler
  });

  it('jeton OAuth réutilisé, demandé une seule fois pour des envois parallèles, redemandé après un 401', async () => {
    const s = sender();
    const before = oauthCalls;
    await Promise.all([s.send(target('ok-1'), msg), s.send(target('ok-2'), msg), s.send(target('ok-3'), msg)]);
    await s.send(target('ok-4'), msg);
    expect(oauthCalls - before).toBe(1);
    revokeNextToken = true;
    await expect(s.send(target('ok-5'), msg)).resolves.toEqual({ ok: true });
    expect(oauthCalls - before).toBe(2);
    expect(sends.at(-1)!.auth).not.toBe(sends.at(-2)!.auth);
  });

  it('traduction des réponses : seuls les jetons refusés sans ambiguïté retirent l’appareil', async () => {
    const s = sender();
    await expect(s.send(target('gone'), msg)).resolves.toEqual({ ok: false, permanent: true, reason: 'unregistered' });
    await expect(s.send(target('other-project'), msg)).resolves.toEqual({ ok: false, permanent: true, reason: 'sender_id_mismatch' });
    // Un 400 peut venir de notre message : jamais de suppression d'appareil, échec visible dans la surveillance.
    await expect(s.send(target('bad'), msg)).resolves.toEqual({ ok: false, permanent: false, reason: 'invalid_argument' });
    await expect(s.send(target('busy'), msg)).resolves.toEqual({ ok: false, permanent: false, reason: 'http_503' });
    await expect(s.send(target('quota'), msg)).resolves.toEqual({ ok: false, permanent: false, reason: 'quota' });
  });

  it('délai dépassé ou serveur injoignable : échec passager (le worker réessaie)', async () => {
    await expect(sender(300).send(target('slow'), msg)).resolves.toEqual({ ok: false, permanent: false, reason: 'timeout' });
    const down = new FcmPushSender({ account: account(), apiBaseUrl: 'http://127.0.0.1:9', tokenUrl: 'http://127.0.0.1:9/token' });
    await expect(down.send(target('ok'), msg)).resolves.toEqual({ ok: false, permanent: false, reason: 'network' });
  });

  it('compte de service mal formé : refusé sans recopier la clé dans le message d’erreur', () => {
    expect(() => parseServiceAccount('pas du json')).toThrow(/JSON valide/);
    expect(() => parseServiceAccount(JSON.stringify({ project_id: 'x', client_email: 'y', private_key: 'secret-123' }))).toThrow(/private_key/);
    try {
      parseServiceAccount(JSON.stringify({ project_id: 'x', client_email: 'y', private_key: 'secret-123' }));
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-123');
    }
  });
});
