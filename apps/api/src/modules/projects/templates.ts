/**
 * Choix du modèle de programme validé (fonction pure, partagée par la création de projet et par Peni, règle R5) :
 * même catégorie, objectif identique de préférence (sinon modèle de la catégorie sans objectif), mode identique de
 * préférence (sinon « any »).
 */
export interface TemplateRef {
  categoryCode: string;
  goalCode: string | null;
  mode: string;
  status: string;
  durationDays: number;
}

export function pickTemplate<T extends TemplateRef>(templates: T[], categoryCode: string, goalCode: string | null, mode: 'eco' | 'premium'): T | null {
  const published = templates.filter((t) => t.categoryCode === categoryCode && t.status === 'published' && (t.mode === 'any' || t.mode === mode));
  const rank = (t: T) => (t.goalCode === goalCode ? 0 : 2) + (t.mode === mode ? 0 : 1);
  const candidates = published.filter((t) => t.goalCode === goalCode || t.goalCode === null).sort((a, b) => rank(a) - rank(b));
  return candidates[0] ?? null;
}
