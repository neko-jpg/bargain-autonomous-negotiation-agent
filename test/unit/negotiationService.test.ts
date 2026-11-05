import { executeNegotiationAction, NegotiationServiceError } from '../../src/lib/negotiation/service';
import { commitSession, createNegotiationSession, findListing, getSession, makeOffer, toPublicSession } from '../../src/lib/negotiation/sessionStore';
import { DEFAULT_BUYER_POLICY_SWITCH } from '../../src/lib/mockData';
import { defaultNegotiationTerms } from '../../src/lib/negotiation/terms';
import { decideApprovalTask, listApprovalTasks } from '../../src/lib/negotiation/workflowStore';
import { getSandboxEffects } from '../../src/lib/safety/executors';

export async function runNegotiationServiceTests(): Promise<boolean> {
  console.log('\n--- 🔐 Running Negotiation Service Contract Tests ---');
  let passed = true;
  const listing = findListing('listing-switch-demo');
  if (!listing) return false;
  const created = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const buyer = { id: created.buyerId, role: 'buyer' as const };
  const publicSession = toPublicSession(created);

  const serializedPublic = JSON.stringify(publicSession);
  if (!('buyerPrivateState' in publicSession)
    && !('buyerPolicy' in publicSession)
    && !serializedPublic.includes('maxPrice')
    && !serializedPublic.includes('minPrice')
    && !serializedPublic.includes('targetPrice')
    && !serializedPublic.includes('deadlineDays')) {
    console.log('✅ [PASS] Public session removes private agent state and policies');
  } else {
    console.error('❌ [FAIL] Public session leaked private state');
    passed = false;
  }

  const request = { type: 'auto_step' as const, expectedVersion: 0, idempotencyKey: `${created.id}-contract-step` };
  const first = await executeNegotiationAction(created.id, request, buyer);
  const replay = await executeNegotiationAction(created.id, request, buyer);
  if (first.version === 1 && first.offers.length === 1 && replay.version === 1 && replay.offers.length === 1 && replay.viewer?.role === 'buyer') {
    console.log('✅ [PASS] Versioning and idempotency prevent duplicate actions (replay keeps the viewer shape)');
  } else {
    console.error('❌ [FAIL] Idempotent action replay changed the session');
    passed = false;
  }

  try {
    await executeNegotiationAction(created.id, { type: 'auto_step', expectedVersion: 0, idempotencyKey: `${created.id}-stale` }, buyer);
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
  const seedBuyer = { id: approvalSeed.buyerId, role: 'buyer' as const };
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
  }, seedBuyer);
  if (accepted.status === 'deal' && accepted.offers.at(-1)?.senderRole === 'buyer_human' && accepted.commitReceipt?.authorizationMode === 'human') {
    console.log('✅ [PASS] A human acceptance signs and commits the exact purchase intent');
  } else {
    console.error(`❌ [FAIL] Human acceptance did not commit the purchase (status=${accepted.status})`);
    passed = false;
  }

  const crossSessionA = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const crossSessionB = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const sharedKey = 'cross-session-idempotency-key';
  await executeNegotiationAction(crossSessionA.id, { type: 'stop', expectedVersion: 0, idempotencyKey: sharedKey }, { id: crossSessionA.buyerId, role: 'buyer' });
  const isolatedReplay = await executeNegotiationAction(crossSessionB.id, { type: 'stop', expectedVersion: 0, idempotencyKey: sharedKey }, { id: crossSessionB.buyerId, role: 'buyer' });
  if (isolatedReplay.status === 'rejected' && isolatedReplay.id === crossSessionB.id) {
    console.log('✅ [PASS] Idempotency keys are scoped to a negotiation');
  } else {
    console.error('❌ [FAIL] Idempotency key crossed negotiation boundaries');
    passed = false;
  }

  try {
    await executeNegotiationAction(crossSessionB.id, { type: 'resume', expectedVersion: 0, idempotencyKey: sharedKey }, { id: crossSessionB.buyerId, role: 'buyer' });
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
    await executeNegotiationAction(crossSessionA.id, { type: 'human_offer', expectedVersion: 1, idempotencyKey: 'terminal-mutation-key', offerPrice: listing.price }, { id: crossSessionA.buyerId, role: 'buyer' });
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

  // Agent accepts on the buyer's behalf with autoPurchase=false: the purchase
  // must wait in awaiting_commit until the buyer approves from the queue.
  const workflowSeed = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH, autoPurchase: false });
  const workflowBuyer = { id: workflowSeed.buyerId, role: 'buyer' as const };
  // Above the seller's effective floor and within the buyer agent's acceptance band.
  const sellerProposal = makeOffer(
    workflowSeed,
    Math.round(DEFAULT_BUYER_POLICY_SWITCH.targetPrice * 1.05 / 100) * 100,
    'seller_agent',
    'Seller Agent',
    'この条件でご検討ください。',
    'counter_offer',
    defaultNegotiationTerms(listing)
  );
  const activeWithSellerOffer = commitSession({ ...sellerProposal, currentTurn: 'buyer', status: 'active' }, 0);
  const agreed = await executeNegotiationAction(workflowSeed.id, {
    type: 'auto_step',
    expectedVersion: activeWithSellerOffer.version ?? 0,
    idempotencyKey: 'commit-approval-seed-step',
  }, workflowBuyer);
  const effectsBefore = getSandboxEffects(workflowSeed.id).length;
  const commitTask = (await listApprovalTasks('pending')).find((task) => task.negotiationId === workflowSeed.id && task.kind === 'commit');
  if (agreed.status !== 'awaiting_commit' || !commitTask || effectsBefore !== 0) {
    console.error(`❌ [FAIL] Agent agreement did not wait for the buyer (status=${agreed.status}, effects=${effectsBefore})`);
    passed = false;
  } else {
    console.log('✅ [PASS] Agent agreement waits in awaiting_commit with zero effects executed');
    const resolved = await decideApprovalTask(commitTask.id, 'approve', commitTask.version, 'commit-approval-apply', workflowBuyer);
    const completed = getSession(workflowSeed.id);
    if (resolved.status === 'approved' && completed?.status === 'deal' && getSandboxEffects(workflowSeed.id).length === 1) {
      console.log('✅ [PASS] Queue approval executes the purchase exactly once');
    } else {
      console.error('❌ [FAIL] Queue approval did not execute the purchase');
      passed = false;
    }
  }

  return passed;
}
