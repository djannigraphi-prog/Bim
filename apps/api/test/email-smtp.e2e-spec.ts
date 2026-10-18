import { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { Harness, newUser, startHarness } from './harness';

/** V1 — Codes par e-mail via SMTP (gratuit au lancement, même prise ensuite) : le code arrive, il n'est jamais journalisé. */
describe('E-mail par SMTP (e2e)', () => {
  let h: Harness;
  let server: SMTPServer;
  const inbox: { to: string; raw: string }[] = [];

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, session, done) {
        let raw = '';
        stream.on('data', (c: Buffer) => (raw += c.toString('utf8')));
        stream.on('end', () => {
          inbox.push({ to: session.envelope.rcptTo.map((r) => r.address).join(','), raw });
          done();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.server.address() as AddressInfo).port;
    h = await startHarness({ EMAIL_PROVIDER: 'smtp', SMTP_URL: `smtp://127.0.0.1:${port}`, EMAIL_FROM: 'BIM <codes@bim.test>' });
  });
  afterAll(async () => {
    await h.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('inscription par e-mail : le code arrive par SMTP et active le compte', async () => {
    const email = `awa.${Date.now()}@exemple.ci`;
    const body = { ...newUser({ phone: undefined }), email };
    const reg = await h.http().post('/v1/auth/register').send(body).expect(201);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].to).toBe(email);
    expect(inbox[0].raw).toMatch(/From: BIM <codes@bim\.test>/);
    const code = /ton code est (\d{6})/.exec(inbox[0].raw.replace(/=\r?\n/g, ''))?.[1];
    expect(code).toMatch(/^\d{6}$/);
    await h.http().post('/v1/auth/register/verify').send({ challengeId: reg.body.verification.challengeId, code }).expect(200);
  });
});
