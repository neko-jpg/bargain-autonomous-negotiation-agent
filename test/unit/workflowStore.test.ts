import { createNegotiationSession, findListing, makeOffer } from '../../src/lib/negotiation/sessionStore';
import { DEFAULT_BUYER_POLICY_SWITCH } from '../../src/lib/mockData';
import { defaultNegotiationTerms } from '../../src/lib/negotiation/terms';
import { scoreAgentAlternatives } from '../../src/lib/agent/strategyScorer';
import {
  buildContractDraft,
  createContractApproval,
  decideApprovalTask,
  getContractDrafts,
  listApprovalTasks,
  saveContractDraft,
} from '../../src/lib/negotiation/workflowStore';

export async function runWorkflowStoreTests(): Promise<boolean> {
  console.log('\n--- 🧾 Running Agent Workflow Tests ---');
  const listing = findListing('listing-switch-demo');
  if (!listing) return false;
  let passed = true;

  const terms = defaultNegotiationTerms(listing);
  const scored = scoreAgentAlternatives('buyer', listing, DEFAULT_BUYER_POLICY_SWITCH, [], [
    { action: 'counter_offer', price: DEFAULT_BUYER_POLICY_SWITCH.maxPrice + 10_000, terms, rationale: '上限を超える案', confidence: 0.9, risks: [] },
    { action: 'counter_offer', price: DEFAULT_BUYER_POLICY_SWITCH.targetPrice, terms, rationale: '上限内の案', confidence: 0.6, risks: [] },
  ]);
  if (scored.candidates[0]?.isValid === false && scored.candidates[scored.selectedIndex]?.isValid) {
    console.log('✅ [PASS] Invalid agent alternatives are rejected before selection');
  } else {
    console.error('❌ [FAIL] Strategy scorer selected an invalid alternative');
    passed = false;
  }

  const seed = createNegotiationSession(listing, { ...DEFAULT_BUYER_POLICY_SWITCH });
  const accepted = makeOffer(seed, DEFAULT_BUYER_POLICY_SWITCH.targetPrice, 'seller_agent', 'Seller Agent', '合意できます。', 'accept_offer', terms);
  const dealSession = {
    ...accepted,
    status: 'deal' as const,
    dealSummary: {
      agreedPrice: DEFAULT_BUYER_POLICY_SWITCH.targetPrice,
      initialPrice: listing.price,
      buyerSaved: listing.price - DEFAULT_BUYER_POLICY_SWITCH.targetPrice,
      buyerSavedPercent: 10,
      sellerSurplus: 1000,
      totalRounds: accepted.offers.length,
      totalActions: accepted.offers.length,
      humanMessagesCount: 0,
      completedAt: new Date().toISOString(),
    },
  };
  const draft = await saveContractDraft(buildContractDraft(dealSession));
  const approval = await createContractApproval(dealSession, draft);
  const pending = await listApprovalTasks('pending');
  const resolved = await decideApprovalTask(approval.id, 'approve', approval.version, `workflow-test-${approval.id}`);
  const stored = await getContractDrafts(dealSession.id);
  if (draft.status === 'pending_approval' && pending.some((task) => task.id === approval.id) && resolved.status === 'approved' && stored[0]?.status === 'approved') {
    console.log('✅ [PASS] Contract draft and approval task persist through approval');
  } else {
    console.error('❌ [FAIL] Contract draft approval workflow did not complete');
    passed = false;
  }

  return passed;
}

