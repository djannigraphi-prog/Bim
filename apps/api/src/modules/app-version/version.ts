/** Compare deux versions « x.y.z » (suffixe de build « +n » ignoré) ; null si l'une n'est pas lisible. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => {
    const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:\+\d{1,9})?$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const APP_PLATFORMS = ['android', 'ios'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];
export const VERSION_HEADER = 'x-bim-app-version';
export const PLATFORM_HEADER = 'x-bim-platform';
export const UPDATE_AVAILABLE_HEADER = 'x-bim-update-available';
