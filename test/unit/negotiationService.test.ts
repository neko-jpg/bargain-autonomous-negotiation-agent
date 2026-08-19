import { executeNegotiationAction, NegotiationServiceError } from '../../src/lib/negotiation/service';
import { commitSession, createNegotiationSession, findListing, getSession, makeOffer, toPublicSession } from '../../src/lib/negotiation/sessionStore';
import { DEFAULT_BUYER_POLICY_SWITCH } from '../../src/lib/mockData';
import { defaultNegotiationTerms } from '../../src/lib/negotiation/terms';
import { decideApprovalTask, listApprovalTasks } from '../../src/lib/negotiation/workflowStore';

export async function runNegotiationServiceTests(): Promise<boolean> {
  console.log('\n--- 🔐 Running Negotiation Service Contract Tests ---');
  let passed = true;
  const listing = findListing('listing-switch-demo');
  if (!listing) return false;
  const created = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const publicSession = toPublicSession(created);

  const serializedPublic = JSON.stringify(publicSession);
  if (!('buyerPrivateState' in publicSession)
    && !('targetPrice' in publicSession.buyerPolicy)
    && !('maxPrice' in publicSession.buyerPolicy)
    && !serializedPublic.includes('maxPrice')
    && !serializedPublic.includes('minPrice')) {
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
    targetOfferId: paused.offers.at(-1)?.id ?? '',
    targetOfferVersion: paused.offers.at(-1)?.version,
    idempotencyKey: `${approvalSeed.id}-approval-contract`,
  });
  if (accepted.status === 'deal' && accepted.offers.at(-1)?.senderRole === 'buyer_human') {
    console.log('✅ [PASS] Human approval commits a policy-validated agreement');
  } else {
    console.error('❌ [FAIL] Human approval did not complete the agreement');
    passed = false;
  }

  const crossSessionA = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const crossSessionB = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const sharedKey = 'cross-session-idempotency-key';
  await executeNegotiationAction(crossSessionA.id, { type: 'stop', expectedVersion: 0, idempotencyKey: sharedKey });
  const isolatedReplay = await executeNegotiationAction(crossSessionB.id, { type: 'stop', expectedVersion: 0, idempotencyKey: sharedKey });
  if (isolatedReplay.status === 'rejected' && isolatedReplay.id === crossSessionB.id) {
    console.log('✅ [PASS] Idempotency keys are scoped to a negotiation');
  } else {
    console.error('❌ [FAIL] Idempotency key crossed negotiation boundaries');
    passed = false;
  }

  try {
    await executeNegotiationAction(crossSessionB.id, { type: 'resume', expectedVersion: 0, idempotencyKey: sharedKey });
    console.error('❌ [FAIL] Reused idempotency key with a different request was accepted');
    passed = false;
  } catch (error) {
    if (error instanceof NegotiationServiceError && error.code === 'IDEMPOTENCY_KEY_REUSE') {
      console.log('✅ [PASS] Reusing an idempotency key with a different request is rejected');
    } else {
      console.error('❌ [FAIL] Idempotency key reuse returned an unexpected error');
      passed = false;
    }
  }

  try {
    await executeNegotiationAction(crossSessionA.id, { type: 'human_offer', expectedVersion: 1, idempotencyKey: 'terminal-mutation-key', offerPrice: listing.price });
    console.error('❌ [FAIL] Terminal session accepted a mutation');
    passed = false;
  } catch (error) {
    if (error instanceof NegotiationServiceError && error.code === 'SESSION_ALREADY_FINISHED') {
      console.log('✅ [PASS] Terminal sessions are immutable');
    } else {
      console.error('❌ [FAIL] Terminal session returned an unexpected error');
      passed = false;
    }
  }

  const approvalWorkflowSeed = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH, autoPurchase: false });
  const sellerProposal = makeOffer(
    approvalWorkflowSeed,
    DEFAULT_BUYER_POLICY_SWITCH.targetPrice,
    'seller_agent',
    'Seller Agent',
    'この条件でご検討ください。',
    'counter_offer',
    defaultNegotiationTerms(listing)
  );
  const activeWithSellerOffer = commitSession({ ...sellerProposal, currentTurn: 'buyer', status: 'active' }, 0);
  const pausedByAgent = await executeNegotiationAction(approvalWorkflowSeed.id, {
    type: 'auto_step',
    expectedVersion: activeWithSellerOffer.version ?? 0,
    idempotencyKey: 'reply-approval-seed-step',
  });
  const replyTask = (await listApprovalTasks('pending')).find((task) => task.negotiationId === approvalWorkflowSeed.id && task.kind === 'reply');
  if (!replyTask || pausedByAgent.status !== 'paused_for_human') {
    console.error('❌ [FAIL] Agent approval task was not created');
    passed = false;
  } else {
    const resolvedReply = await decideApprovalTask(
      replyTask.id,
      'approve',
      replyTask.version,
      'reply-approval-apply',
      { id: approvalWorkflowSeed.buyerId, role: 'buyer' }
    );
    const completed = getSession(approvalWorkflowSeed.id);
    if (resolvedReply.status === 'approved' && completed?.status === 'deal' && completed.offers.at(-1)?.targetOfferId === sellerProposal.offers.at(-1)?.id) {
      console.log('✅ [PASS] Reply approval resumes and applies the exact target offer');
    } else {
      console.error('❌ [FAIL] Reply approval did not resume the negotiation');
      passed = false;
    }
  }

  return passed;
}
