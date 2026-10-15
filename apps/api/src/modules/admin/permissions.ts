/**
 * Permissions d'administration par rôle (proposition T-019, à valider par le fondateur).
 * Le principe : chaque rôle ne voit et ne modifie que ce dont il a besoin ; super_admin a tout.
 */
export const ADMIN_PERMISSIONS = {
  'settings.read': ['super_admin', 'support', 'moderator', 'commercial', 'finance', 'tech'],
  'settings.write': ['super_admin'],
  'audit.read': ['super_admin', 'support', 'tech'],
  'users.read': ['super_admin', 'support', 'moderator'],
  'users.suspend': ['super_admin', 'support', 'moderator'],
  'programs.read': ['super_admin', 'commercial', 'support'],
  'programs.write': ['super_admin', 'commercial'],
  'programs.publish': ['super_admin'],
  'catalog.write': ['super_admin', 'commercial'],
  'reports.read': ['super_admin', 'support', 'moderator'],
  'reports.resolve': ['super_admin', 'support', 'moderator'],
  'admins.manage': ['super_admin'],
  /** Surveillance technique (état du worker des rappels…) : exploitation, pas d'accès aux données des personnes. */
  'system.health': ['super_admin', 'tech', 'support'],
} as const;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

export function permissionsFor(roles: string[]): AdminPermission[] {
  return (Object.keys(ADMIN_PERMISSIONS) as AdminPermission[]).filter((p) =>
    (ADMIN_PERMISSIONS[p] as readonly string[]).some((r) => roles.includes(r)),
  );
}
