import QRCode from 'qrcode';
import { FormEvent, useEffect, useState } from 'react';
import { AdminProfile, api, errorText, setToken } from '../api';

type Step = { kind: 'password' } | { kind: 'totp'; loginToken: string; enroll?: { secret: string; uri: string; qr: string } };

/** Connexion : e-mail + mot de passe, puis code de l'application d'authentification (obligatoire). */
export function Login({ onSignedIn }: { onSignedIn: (me: AdminProfile) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(null), [step.kind]);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ loginToken: string; next: 'totp' | 'totp_enrollment' }>('/admin/v1/auth/login', { method: 'POST', body: { email, password }, auth: false });
      setPassword('');
      if (r.next === 'totp_enrollment') {
        const en = await api<{ secret: string; otpauthUri: string }>('/admin/v1/auth/totp/enrollment', { method: 'POST', body: { loginToken: r.loginToken }, auth: false });
        const qr = await QRCode.toDataURL(en.otpauthUri, { margin: 1, width: 200 });
        setStep({ kind: 'totp', loginToken: r.loginToken, enroll: { secret: en.secret, uri: en.otpauthUri, qr } });
      } else {
        setStep({ kind: 'totp', loginToken: r.loginToken });
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'totp') return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ accessToken: string; admin: AdminProfile }>('/admin/v1/auth/totp/verify', { method: 'POST', body: { loginToken: step.loginToken, code }, auth: false });
      setToken(r.accessToken);
      onSignedIn(r.admin);
    } catch (err) {
      setError(errorText(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>BIM · Administration</h1>
      {step.kind === 'password' ? (
        <form onSubmit={submitPassword}>
          <label>
            E-mail
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Mot de passe
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button disabled={busy}>Continuer</button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          {step.enroll ? (
            <div className="enroll">
              <p>
                <strong>Première connexion :</strong> la double authentification est obligatoire. Scanne ce code avec une application
                d'authentification (Google Authenticator, Microsoft Authenticator…), puis saisis le code affiché.
              </p>
              <img src={step.enroll.qr} alt="QR code de double authentification" width={200} height={200} />
              <p className="muted">
                Ou saisis la clé : <code data-testid="totp-secret">{step.enroll.secret}</code>
              </p>
            </div>
          ) : (
            <p>Saisis le code à 6 chiffres de ton application d'authentification.</p>
          )}
          <label>
            Code
            <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button disabled={busy || code.length !== 6}>Se connecter</button>
          <button type="button" className="link" onClick={() => setStep({ kind: 'password' })}>
            Recommencer
          </button>
        </form>
      )}
    </div>
  );
}
