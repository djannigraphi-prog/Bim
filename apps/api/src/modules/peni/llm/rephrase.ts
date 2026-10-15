/**
 * Peni IA, étape 2 : reformulation des réponses du moteur guidé par un fournisseur d'IA, sous contrôle du serveur.
 *
 * Ne lance jamais d'exception : en cas de refus, d'erreur, de délai dépassé ou de réponse non conforme, renvoie
 * `texts: null` et la raison ; l'appelant garde alors la réponse guidée intacte (règle R1 : Peni fonctionne sans IA).
 * Seuls les textes peuvent changer ; boutons, pose, récapitulatif, état et brouillon restent ceux du moteur guidé.
 */
import type { EngineContext, EngineInput, PeniReply, PeniState } from '../engine';
import type { LlmProvider } from '../llm-provider';
import { buildContext, NAME_PLACEHOLDER } from './context';
import { PENI_MAX_OUTPUT_TOKENS, PENI_PROMPT_VERSION, PENI_SYSTEM_PROMPT } from './prompt';
import { verify } from './verifier';

/** Délai maximal d'une réponse de l'IA, bien en dessous du délai de l'app (20 s) : au-delà, réponse guidée. */
export const PENI_AI_TIMEOUT_MS = 8000;

export interface RephraseOutcome {
  /** Textes reformulés, un par réponse, ou null : garder les textes guidés. */
  texts: string[] | null;
  /** used | skipped_safety | skipped_summary | timeout | provider_error | <raison du vérificateur>. */
  outcome: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  promptVersion: string;
}

/** Réponses jamais confiées à l'IA : santé et urgence (texte validé, numéros d'urgence), récapitulatif du brouillon. */
export function eligible(replies: PeniReply[]): 'ok' | 'skipped_safety' | 'skipped_summary' {
  if (replies.some((r) => r.safety)) return 'skipped_safety';
  if (replies.some((r) => r.summary?.length)) return 'skipped_summary';
  return 'ok';
}

export async function rephrase(
  provider: LlmProvider,
  args: { state: PeniState; input: EngineInput; replies: PeniReply[]; ctx: EngineContext },
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<RephraseOutcome> {
  const now = opts.now ?? Date.now;
  const started = now();
  const base = { ms: 0, inputTokens: 0, outputTokens: 0, promptVersion: PENI_PROMPT_VERSION };
  const skip = eligible(args.replies);
  if (skip !== 'ok') return { ...base, texts: null, outcome: skip };

  const context = buildContext(args.state, args.input, args.replies, args.ctx);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? PENI_AI_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      provider.complete({
        purpose: 'peni_reply',
        system: PENI_SYSTEM_PROMPT,
        messages: [{ role: 'user', text: JSON.stringify(context) }],
        maxOutputTokens: PENI_MAX_OUTPUT_TOKENS,
        signal: controller.signal,
      }),
      deadline,
    ]);
    const ms = now() - started;
    if (result === 'timeout') {
      controller.abort();
      return { ...base, ms, texts: null, outcome: 'timeout' };
    }
    const usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    const verdict = verify(result.text, context.reponses, context.message_personne);
    if (!verdict.ok) return { ...base, ...usage, ms, texts: null, outcome: verdict.reason };
    const name = args.ctx.firstName.trim();
    return { ...base, ...usage, ms, texts: verdict.texts.map((t) => t.replaceAll(NAME_PLACEHOLDER, name)), outcome: 'used' };
  } catch {
    return { ...base, ms: now() - started, texts: null, outcome: 'provider_error' };
  } finally {
    clearTimeout(timer);
  }
}
