import {
  AgentAlternative,
  BuyerPolicy,
  Listing,
  NegotiationOffer,
  SellerPolicy,
} from '@/types/negotiation';
import { sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import { totalOfferCost } from '@/lib/negotiation/terms';
import { buildPublicOfferMessage } from '@/lib/negotiation/messages';

export interface ScoredAlternative extends AgentAlternative {
  score: number;
  isValid: boolean;
  policyIssues: string[];
}

/**
 * LLM候補を決定論的ポリシーで検証し、価格・条件・リスクのバランスを
 * 比較する。LLMの並び順や自信度をそのまま採用しないのが重要な境界です。
 */
export function scoreAgentAlternatives(
  role: 'buyer' | 'seller',
  listing: Listing,
  policy: BuyerPolicy | SellerPolicy,
  history: NegotiationOffer[],
  alternatives: AgentAlternative[]
): { candidates: ScoredAlternative[]; selectedIndex: number } {
  const scored = alternatives.map((alternative) => {
    const issues: string[] = [];
    const price = Math.max(0, Math.round(alternative.price ?? listing.price));
    const decision = sanitizeOfferByPolicy(
      role,
      listing,
      policy,
      price,
      alternative.terms,
      alternative.action
    );

    if (decision.correctionReason) issues.push(decision.correctionReason);
    if (alternative.action === 'wait' && !alternative.price) {
      issues.push('待機候補に基準価格がありません。');
    }

    const total = totalOfferCost(decision.price, decision.terms);
    const priceDistance = Math.abs(decision.price - listing.marketMedianPrice) / Math.max(1, listing.marketMedianPrice);
    const lastOpponentOffer = [...history]
      .reverse()
      .find((offer) => role === 'buyer' ? offer.senderRole.includes('seller') : offer.senderRole.includes('buyer'));
    const repeated = history.some((offer) => offer.actionType === alternative.action && offer.price === decision.price && JSON.stringify(offer.terms) === JSON.stringify(decision.terms));
    const expectedUtility = role === 'buyer'
      ? 100 - (total / Math.max(1, listing.price)) * 100
      : (total / Math.max(1, listing.price)) * 100;
    const responseFit = lastOpponentOffer
      ? 50 - (Math.abs(total - totalOfferCost(lastOpponentOffer.price, lastOpponentOffer.terms ?? decision.terms)) / Math.max(1, listing.price)) * 100
      : 25;
    const actionValue = alternative.action === 'accept_offer' && lastOpponentOffer && decision.price === lastOpponentOffer.price ? 20 : 0;
    const delayPenalty = alternative.action === 'wait' ? 8 : 0;
    const riskPenalty = alternative.risks.length * 4 + (repeated ? 18 : 0);
    // LLM self-reported confidence is telemetry only; it is deliberately not scored.
    const score = Math.round((expectedUtility * 0.55 + responseFit * 0.35 + actionValue - priceDistance * 12 - delayPenalty - riskPenalty) * 100) / 100;

    return {
      ...alternative,
      price: decision.price,
      terms: decision.terms,
      publicMessage: buildPublicOfferMessage(role, alternative.action, decision.price, decision.terms, alternative.waitHours),
      targetOfferId: alternative.targetOfferId ?? (alternative.action === 'accept_offer' ? lastOpponentOffer?.id : undefined),
      targetOfferVersion: alternative.targetOfferVersion ?? (alternative.action === 'accept_offer' ? lastOpponentOffer?.version : undefined),
      source: alternative.source ?? 'llm',
      score,
      isValid: issues.length === 0,
      policyIssues: issues,
    } satisfies ScoredAlternative;
  });

  const validIndexes = scored
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.isValid);
  const pool = validIndexes.length > 0 ? validIndexes : scored.map((candidate, index) => ({ candidate, index }));
  const selected = pool.reduce((best, current) => current.candidate.score > best.candidate.score ? current : best);

  return { candidates: scored, selectedIndex: selected.index };
}
