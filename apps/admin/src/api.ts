/**
 * Client de l'API d'administration (/admin/v1). La session est gardée dans sessionStorage :
 * elle disparaît à la fermeture de l'onglet et expire côté serveur (8 h par défaut).
 */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

const KEY = 'bim.admin.session';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : la session reste en mémoire pour cet onglet */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (init.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'API injoignable. Vérifie la connexion.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: { fields?: Record<string, string[]> } } };
  if (!res.ok) {
    if (res.status === 401 && init.auth !== false) {
      setToken(null);
      onUnauthorized();
    }
    const e = data.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? 'Erreur inattendue.', e?.details?.fields ?? {});
  }
  return data as T;
}

export type Permission =
  | 'settings.read'
  | 'settings.write'
  | 'audit.read'
  | 'users.read'
  | 'users.suspend'
  | 'programs.read'
  | 'programs.write'
  | 'programs.publish'
  | 'admins.manage'
  | 'system.health'
  | 'catalog.write'
  | 'reports.read'
  | 'reports.resolve'
  | 'content.read'
  | 'content.moderate';

export interface AdminProfile {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: Permission[];
  lastLoginAt: string | null;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields).flat();
    return f.length ? f.join(' ') : e.message;
  }
  return 'Erreur inattendue.';
}

/** Libellés des jours (bit 0 = lundi). */
export const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function weekdaysLabel(mask: number): string {
  if (mask === 127) return 'Tous les jours';
  return WEEKDAYS.filter((_, i) => mask & (1 << i)).join(' · ');
}
