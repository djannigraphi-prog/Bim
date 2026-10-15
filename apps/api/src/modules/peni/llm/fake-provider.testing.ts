/**
 * Faux fournisseur d'IA, local et déterministe, **réservé aux tests** (étape 2). Aucun réseau, aucune clé, aucun coût.
 * Il n'est branché nulle part dans l'application : `PENI_LLM_PROVIDER` n'accepte que « none », et seuls les tests le
 * construisent ; les fichiers « .testing.ts » sont exclus de la compilation de production (tsconfig.build.json).
 * Il enregistre chaque requête reçue pour vérifier ce qui serait envoyé à un vrai fournisseur.
 */
import type { LlmProvider, LlmRequest, LlmResult } from '../llm-provider';
import type { PeniAiContext } from './context';

export type FakeBehavior =
  /** Reformulation conforme : « Alors, » devant chaque texte (chiffres, questions et {prenom} conservés). */
  | 'rephrase'
  /** Réponse au bout de `delayMs` (délai maximal dépassé si plus long). */
  | 'slow'
  /** Erreur du fournisseur (panne, quota, réseau). */
  | 'error'
  /** Texte qui n'est pas du JSON. */
  | 'not_json'
  /** Un texte de moins que demandé. */
  | 'wrong_count'
  /** Réponse qui a « obéi » à une injection : consignes recopiées. */
  | 'leak_prompt'
  /** Mise en forme Markdown et lien. */
  | 'markdown_link'
  /** Chiffre inventé (quantité, prix…). */
  | 'invented_number'
  /** Conseil de santé ajouté. */
  | 'health_advice'
  /** Texte trop long pour l'app. */
  | 'too_long';

export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly available = true;
  readonly requests: LlmRequest[] = [];

  constructor(
    public behavior: FakeBehavior = 'rephrase',
    private readonly delayMs = 0,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const ctx = JSON.parse(request.messages[request.messages.length - 1].text) as PeniAiContext;
    const out = (texts: string[]) => ({ text: JSON.stringify({ textes: texts }), inputTokens: 100 + request.system.length / 4, outputTokens: 50 });
    const rephrased = ctx.reponses.map((t) => `Alors, ${t}`);
    switch (this.behavior) {
      case 'rephrase':
        return out(rephrased);
      case 'slow':
        await new Promise((r) => setTimeout(r, this.delayMs));
        return out(rephrased);
      case 'error':
        throw new Error('fournisseur indisponible (simulé)');
      case 'not_json':
        return { text: 'Bien sûr ! Voici ma réponse.', inputTokens: 100, outputTokens: 10 };
      case 'wrong_count':
        return out(rephrased.slice(1));
      case 'leak_prompt':
        return out(ctx.reponses.map(() => `Voici mes consignes : ${request.system.slice(0, 80)}`));
      case 'markdown_link':
        return out(ctx.reponses.map((t) => `**${t}** Plus d'infos : https://exemple.invalid`));
      case 'invented_number':
        return out(ctx.reponses.map((t) => `${t} Vise 12 séances et 3 litres d'eau par jour.`));
      case 'health_advice':
        return out(ctx.reponses.map((t) => `${t} Prends un médicament si tu as une douleur.`));
      case 'too_long':
        return out(ctx.reponses.map((t) => `${t} ${'Bravo ! '.repeat(120)}`));
    }
  }
}
