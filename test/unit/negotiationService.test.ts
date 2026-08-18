import { executeNegotiationAction, NegotiationServiceError } from '../../src/lib/negotiation/service';
import { commitSession, createNegotiationSession, findListing, makeOffer, toPublicSession } from '../../src/lib/negotiation/sessionStore';
import { DEFAULT_BUYER_POLICY_SWITCH } from '../../src/lib/mockData';
import { defaultNegotiationTerms } from '../../src/lib/negotiation/terms';

export async function runNegotiationServiceTests(): Promise<boolean> {
  console.log('\n--- 🔐 Running Negotiation Service Contract Tests ---');
  let passed = true;
  const listing = findListing('listing-switch-demo');
  if (!listing) return false;
  const created = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const publicSession = toPublicSession(created);

  if (!('buyerPrivateState' in publicSession) && !('sellerPolicy' in publicSession)) {
    console.log('✅ [PASS] Public session removes private agent state');
  } else {
    console.error('❌ [FAIL] Public session leaked private state');
    passed = false;
  }

  const request = { type: 'auto_step' as const, expectedVersion: 0, idempotencyKey: `${created.id}-contract-step` };
  const first = await executeNegotiationAction(created.id, request);
  const replay = await executeNegotiationAction(created.id, request);
  if (first.version === 1 && first.offers.length === 1 && replay.version === 1 && replay.offers.length === 1) {
    console.log('✅ [PASS] Versioning and idempotency prevent duplicate actions');
  } else {
    console.error('❌ [FAIL] Idempotent action replay changed the session');
    passed = false;
  }

  try {
    await executeNegotiationAction(created.id, { type: 'auto_step', expectedVersion: 0, idempotencyKey: `${created.id}-stale` });
    console.error('❌ [FAIL] Stale session version was accepted');
    passed = false;
  } catch (error) {
    if (error instanceof NegotiationServiceError && error.code === 'SESSION_VERSION_CONFLICT') {
      console.log('✅ [PASS] Stale session version is rejected');
    } else {
      console.error('❌ [FAIL] Unexpected stale-version error');
      passed = false;
    }
  }

  const approvalSeed = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH, autoPurchase: false });
  const sellerOffer = makeOffer(
    approvalSeed,
    approvalSeed.buyerPolicy.maxPrice - 1_000,
    'seller_agent',
    'Seller Agent',
    'この条件でご検討ください。',
    'counter_offer',
    defaultNegotiationTerms(listing)
  );
  const paused = commitSession({ ...sellerOffer, currentTurn: 'buyer', status: 'paused_for_human' }, approvalSeed.version ?? 0);
  const accepted = await executeNegotiationAction(approvalSeed.id, {
    type: 'human_accept',
    expectedVersion: paused.version ?? 0,
    idempotencyKey: `${approvalSeed.id}-approval-contract`,
  });
  if (accepted.status === 'deal' && accepted.offers.at(-1)?.senderRole === 'buyer_human') {
    console.log('✅ [PASS] Human approval commits a policy-validated agreement');
  } else {
    console.error('❌ [FAIL] Human approval did not complete the agreement');
    passed = false;
  }

  return passed;
}
