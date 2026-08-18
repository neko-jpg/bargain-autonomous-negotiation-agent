import {
  AgentAlternative,
  BuyerPolicy,
  Listing,
  NegotiationOffer,
  SellerPolicy,
} from '@/types/negotiation';
import { sanitizeOfferByPolicy } from '@/lib/negotiation/policyEngine';
import { totalOfferCost } from '@/lib/negotiation/terms';

export interface ScoredAlternative extends AgentAlternative {
  score: number;
  isValid: boolean;
  policyIssues: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
    const confidence = clamp(alternative.confidence, 0, 1);
    const riskPenalty = alternative.risks.length * 4;
    const actionBonus = alternative.action === 'accept_offer' ? 8 : alternative.action === 'wait' ? 2 : 0;
    const priceScore = role === 'buyer'
      ? 100 - (total / Math.max(1, listing.price)) * 55
      : (total / Math.max(1, listing.price)) * 55;
    const score = Math.round((priceScore + confidence * 20 + actionBonus - priceDistance * 12 - riskPenalty) * 100) / 100;

    return {
      ...alternative,
      price: decision.price,
      terms: decision.terms,
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

