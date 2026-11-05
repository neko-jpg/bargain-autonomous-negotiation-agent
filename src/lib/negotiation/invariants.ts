import { hashIntent } from '@/lib/safety/commitGate';
import { NegotiationOffer, NegotiationSession } from '@/types/negotiation';
import { effectiveSellerFloor } from '@/lib/negotiation/policyEngine';
import { defaultNegotiationTerms, totalOfferCost } from '@/lib/negotiation/terms';

/**
 * Runtime invariant monitor. Every persisted state transition passes through
 * checkTransition() inside commitPersistedSession(), so a bug anywhere above
 * the storage layer cannot write an unsafe state. The same checks are run by
 * the fuzzer and the bounded explorer in test/safety.
 */

export type InvariantId =
  | 'INV-01-terminal-final'
  | 'INV-02-append-only-history'
  | 'INV-03-buyer-ceiling'
  | 'INV-04-seller-floor'
  | 'INV-05-party-binding'
  | 'INV-06-deal-requires-executed-commit'
  | 'INV-07-intent-integrity'
  | 'INV-08-kill-switch-halts-agents';

export const INVARIANTS: Record<InvariantId, string> = {
  'INV-01-terminal-final': 'A session in deal or rejected never changes again.',
  'INV-02-append-only-history': 'Existing offers are never edited, removed or reordered.',
  'INV-03-buyer-ceiling': "Every new buyer-side offer or acceptance costs at most the buyer's maxPrice (price + shipping) and at most the listing price.",
  'INV-04-seller-floor': "Every new seller-side offer or acceptance is at or above the seller's effective floor.",
  'INV-05-party-binding': 'A human offer can only be authored by the authenticated party whose side it speaks for; operators and the system never author offers.',
  'INV-06-deal-requires-executed-commit': 'A session becomes deal only from awaiting_commit, and only with a receipt whose intent hash matches the pending intent and is executed in the effect ledger.',
  'INV-07-intent-integrity': 'A pending commit always hashes to its recorded intent hash and is derived from the latest acceptance.',
  'INV-08-kill-switch-halts-agents': 'While the kill switch is engaged, no agent-authored offer is written (monitor) and the gate executes no new effect (Commit Gate).',
};

export interface TransitionContext {
  actor?: { id: string; role: string };
  killSwitchEngaged: boolean;
  isEffectExecuted: (intentHash: string) => Promise<boolean>;
}

export interface InvariantViolation {
  id: InvariantId;
  detail: string;
}

const PRICED_ACTIONS = new Set<NegotiationOffer['actionType']>(['make_offer', 'counter_offer', 'accept_offer']);
const TERMINAL = new Set<NegotiationSession['status']>(['deal', 'rejected']);

function offerFingerprint(offer: NegotiationOffer) {
  return `${offer.id}|${offer.proposalHash ?? ''}|${offer.price}|${offer.actionType}|${offer.senderRole}`;
}

export async function checkTransition(prev: NegotiationSession, next: NegotiationSession, context: TransitionContext): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const fail = (id: InvariantId, detail: string) => violations.push({ id, detail });

  if (TERMINAL.has(prev.status)) fail('INV-01-terminal-final', `transition out of ${prev.status}`);

  const prefixIntact = next.offers.length >= prev.offers.length
    && prev.offers.every((offer, index) => offerFingerprint(offer) === offerFingerprint(next.offers[index]));
  if (!prefixIntact) fail('INV-02-append-only-history', 'existing offers changed');

  const added = prefixIntact ? next.offers.slice(prev.offers.length) : [];
  for (const offer of added) {
    const side = offer.senderRole.startsWith('buyer') ? 'buyer' : 'seller';
    if (PRICED_ACTIONS.has(offer.actionType)) {
      if (side === 'buyer') {
        const total = totalOfferCost(offer.price, offer.terms ?? defaultNegotiationTerms(next.listing));
        if (total > next.buyerPolicy.maxPrice) fail('INV-03-buyer-ceiling', `${offer.id} total ${total} > ${next.buyerPolicy.maxPrice}`);
        if (offer.price > next.listing.price) fail('INV-03-buyer-ceiling', `${offer.id} price ${offer.price} > listing ${next.listing.price}`);
      } else {
        const floor = effectiveSellerFloor(next.sellerPolicy);
        if (offer.price < floor) fail('INV-04-seller-floor', `${offer.id} price ${offer.price} < ${floor}`);
      }
    }
    if (offer.senderRole.endsWith('_human')) {
      const role = context.actor?.role;
      if (role !== 'buyer' && role !== 'seller') fail('INV-05-party-binding', `${offer.id} authored by ${role ?? 'unknown'}`);
      else if (!offer.senderRole.startsWith(role)) fail('INV-05-party-binding', `${role} authored ${offer.senderRole}`);
    }
    if (context.killSwitchEngaged && offer.senderRole.endsWith('_agent')) {
      fail('INV-08-kill-switch-halts-agents', `${offer.id} written while kill switch engaged`);
    }
  }

  if (next.status === 'deal' && prev.status !== 'deal') {
    const receipt = next.commitReceipt;
    const expected = prev.pendingCommit?.intentHash;
    if (prev.status !== 'awaiting_commit') fail('INV-06-deal-requires-executed-commit', `deal from ${prev.status}`);
    if (!receipt || !expected || receipt.intentHash !== expected) fail('INV-06-deal-requires-executed-commit', 'missing or mismatched receipt');
    else if (!(await context.isEffectExecuted(receipt.intentHash))) fail('INV-06-deal-requires-executed-commit', 'receipt not executed in ledger');
  }

  if (next.status === 'awaiting_commit') {
    const pending = next.pendingCommit;
    if (!pending) fail('INV-07-intent-integrity', 'awaiting_commit without pending intent');
    else {
      if (hashIntent(pending.intent) !== pending.intentHash) fail('INV-07-intent-integrity', 'intent hash mismatch');
      const agreement = next.offers.find((offer) => offer.id === pending.intent.payload.agreementOfferId);
      if (!agreement || agreement.actionType !== 'accept_offer') fail('INV-07-intent-integrity', 'intent not derived from an acceptance');
      else if (agreement.price !== pending.intent.payload.price) fail('INV-07-intent-integrity', 'intent price differs from acceptance');
      if (prev.status !== 'awaiting_commit' && next.offers.at(-1)?.id !== pending.intent.payload.agreementOfferId) {
        fail('INV-07-intent-integrity', 'intent not derived from the latest acceptance');
      }
    }
  }
  if (next.status !== 'awaiting_commit' && next.status !== 'deal' && next.pendingCommit) {
    fail('INV-07-intent-integrity', `pending intent left on ${next.status}`);
  }

  return violations;
}
