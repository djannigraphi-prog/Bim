import { Errors } from '../../common/errors';

/**
 * Point d'intégration d'un futur fournisseur d'IA pour Peni (ANALYSE.md, section 10 : interface `LlmProvider`).
 *
 * **Aucun fournisseur n'est branché** : seul `DisabledLlmProvider` existe, et `PENI_LLM_PROVIDER` n'accepte que « none ».
 * Pour en ajouter un plus tard (après accord du fondateur sur le fournisseur, le coût et l'envoi de données) :
 * 1. une classe qui implémente cette interface (clé d'API dans AWS Secrets Manager, jamais dans le dépôt) ;
 * 2. une valeur de plus dans `PENI_LLM_PROVIDER` ;
 * 3. le réglage `peni.llm_enabled` à true, marqué « decided ».
 * Même alors, la discussion guidée reste la solution de secours : Peni fonctionne sans IA (règle R1).
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  text: string;
}
export interface LlmRequest {
  purpose: 'peni_reply';
  /** Consignes versionnées dans le dépôt (cadrage santé R4, ton de Peni). */
  system: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
  /** Annulation quand le délai maximal est dépassé (étape 2) : le fournisseur doit abandonner la requête. */
  signal?: AbortSignal;
}
export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface LlmProvider {
  readonly name: string;
  /** Faux tant qu'aucun fournisseur n'est configuré. */
  readonly available: boolean;
  complete(request: LlmRequest): Promise<LlmResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** Aucun fournisseur : rien n'est envoyé, nulle part. */
export class DisabledLlmProvider implements LlmProvider {
  readonly name = 'none';
  readonly available = false;
  complete(): Promise<LlmResult> {
    return Promise.reject(Errors.notConfigured('L’assistance par IA de Peni'));
  }
}
