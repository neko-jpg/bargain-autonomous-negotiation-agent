import type { ActionReasoning, LocalizedMessage, NegotiationDecisionMetadata, NegotiationOffer } from '@/types/negotiation';
import type { Translate } from './dictionary';
import { senderKeyFromName, termValueKey } from './termValues';

/**
 * Renders a stored record in the viewer's language.
 *
 * Records created before i18n only carry the rendered string, so the fallback
 * keeps older sessions readable instead of showing an empty message.
 */
export function localizeMessage(
  t: Translate,
  template: LocalizedMessage | undefined,
  fallbackText: string | undefined,
): string {
  if (!template) return fallbackText ?? '';
  return t(template.key, template.params);
}

/** Localises the synthetic "you" sender labels; real seller names pass through. */
export function localizeSenderName(t: Translate, offer: Pick<NegotiationOffer, 'senderKey' | 'senderName'>): string {
  const key = offer.senderKey ?? senderKeyFromName(offer.senderName);
  return key ? t(key) : offer.senderName;
}

/** Localises the app-seeded term values (`即時決済`, `商品説明に準拠`, …). */
export function localizeTermValue(t: Translate, value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const key = termValueKey(value);
  return key ? t(key) : value;
}

/**
 * Reasoning text is written by the agent. Deterministic sources (the scripted
 * demo and the heuristic engine) also ship a template, so they follow the
 * viewer's language; LLM output stays in the language it was generated in.
 */
export function localizeReasoning(t: Translate, reasoning: ActionReasoning | undefined): { summary: string; factors: string[] } | undefined {
  if (!reasoning) return undefined;
  const summary = reasoning.summaryTemplate
    ? t(reasoning.summaryTemplate.key, reasoning.summaryTemplate.params)
    : reasoning.summary;
  const factors = reasoning.factorTemplates?.length
    ? reasoning.factorTemplates.map((factor) => t(factor.key, factor.params))
    : reasoning.factors;
  return { summary, factors };
}

/** Joins any templated guardrail corrections; falls back to the stored text. */
export function localizeGuardrailCorrection(t: Translate, decision: NegotiationDecisionMetadata | undefined): string | undefined {
  if (!decision) return undefined;
  const templates = decision.guardrailCorrectionTemplates;
  if (templates?.length) return templates.map((item) => t(item.key, item.params)).join(' ');
  return decision.guardrailCorrection;
}

/** Localises the human-approval reason attached to a decision. */
export function localizeApprovalReason(t: Translate, decision: NegotiationDecisionMetadata | undefined): string | undefined {
  if (!decision) return undefined;
  if (decision.approvalReasonTemplate) {
    return t(decision.approvalReasonTemplate.key, decision.approvalReasonTemplate.params);
  }
  return decision.approvalReason;
}
