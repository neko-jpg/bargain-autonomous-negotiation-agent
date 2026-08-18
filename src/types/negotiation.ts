export type DelegationLevel = 1 | 2 | 3; // 1: 提案のみ, 2: 交渉代行(購入前確認), 3: 完全委任(自動購入)

export type UrgencyLevel = 'low' | 'medium' | 'high';

export interface Listing {
  id: string;
  title: string;
  price: number;
  category: string;
  imageUrl: string;
  description: string;
  daysListed: number;
  likesCount: number;
  viewsCount: number;
  marketMedianPrice: number;
  competingListingsCount: number;
  recentDemand: 'low' | 'moderate' | 'high';
  sellerName: string;
  condition: 'new' | 'like_new' | 'good' | 'fair';
  images?: string[];
  categoryPath?: string[];
  subcategory?: string;
  brand?: string;
  size?: string;
  color?: string;
  sellerRating?: number;
  sellerRatingsCount?: number;
  shippingMethod?: string;
  shippingDays?: string;
  shippingSize?: string;
  inventoryQuantity?: number;
  searchTags?: string[];
  catalogTitle?: string;
  catalogSource?: {
    photographer?: string;
    attribution?: string;
    sourceUrl?: string;
    checksum?: string;
  };
}

export interface BuyerPolicy {
  targetPrice: number;
  maxPrice: number; // ※Private State
  deadlineDays: number;
  autoPurchase: boolean;
  delegationLevel: DelegationLevel;
  autoNegotiate?: boolean;
  maxDeliveryDays?: number;
  maxShippingCost?: number;
  minQuantity?: number;
  requiredCurrency?: string;
  requireTaxIncluded?: boolean;
  allowedPaymentTerms?: string[];
  autoApprovalMaxPrice?: number;
}

export interface SellerPolicy {
  targetPrice: number;
  minPrice: number; // ※Private State
  urgency: UrgencyLevel;
  deadlineDays: number;
  autoAccept: boolean;
  costPrice?: number;
  minimumProfit?: number;
  minQuantity?: number;
  maxDeliveryDays?: number;
  maxShippingCost?: number;
  requiredCurrency?: string;
  requireTaxIncluded?: boolean;
  allowedPaymentTerms?: string[];
  autoApprovalMinPrice?: number;
}

/**
 * 条件付き交渉で交換する公開オファー条件。priceは商品本体の合計金額です。
 * 既存の価格だけのオファーはterms未設定でも後方互換で扱えます。
 */
export interface NegotiationTerms {
  quantity: number;
  currency: string;
  taxIncluded: boolean;
  shippingCost: number;
  deliveryDays: number;
  paymentTerms: string;
  warranty: string;
  expiresAt?: string;
  concessions: string[];
}

export interface PrivateState {
  reservationPrice: number; // Buyer: maxPrice, Seller: minPrice
  riskTolerance: number; // 0.0 - 1.0
  patienceScore: number; // 0.0 - 1.0
  batna: number; // 最善代替価格
  preferredTerms?: NegotiationTerms;
}

export type AgentActionType =
  | 'make_offer'
  | 'counter_offer'
  | 'accept_offer'
  | 'reject_offer'
  | 'wait'
  | 'ask_user';

export interface ActionReasoning {
  summary: string;
  marketMedian: number;
  daysListed: number;
  demandTrend: string;
  winProbability: number;
  factors: string[];
}

/** Public, explainable metadata that can be shown in the audit trail. */
export interface NegotiationDecisionMetadata {
  guardrailCorrection?: string;
  requiresHumanApproval?: boolean;
  approvalReason?: string;
  candidateCount?: number;
  selectedCandidate?: number;
}

export interface AgentAlternative {
  action: AgentActionType;
  price?: number;
  terms?: NegotiationTerms;
  rationale: string;
  confidence: number;
  risks: string[];
  score?: number;
  policyIssues?: string[];
  isValid?: boolean;
}

export interface NegotiationMemory {
  acceptedConditions: string[];
  rejectedConditions: string[];
  concessionRoom: string;
  counterpartPattern: string;
  nextOptions: string[];
  risks: string[];
  updatedAt: string;
}

export interface NegotiationOffer {
  id: string;
  round: number;
  timestamp: string;
  senderRole: 'buyer_agent' | 'seller_agent' | 'buyer_human' | 'seller_human';
  senderName: string;
  price: number;
  terms?: NegotiationTerms;
  actionType: AgentActionType;
  reasoning?: ActionReasoning;
  decision?: NegotiationDecisionMetadata;
  alternatives?: AgentAlternative[];
  waitTimeHours?: number;
  messageText: string;
}

export type NegotiationStatus =
  | 'initializing'
  | 'active'
  | 'waiting'
  | 'deal'
  | 'rejected'
  | 'paused_for_human';

export interface DealSummary {
  agreedPrice: number;
  initialPrice: number;
  buyerSaved: number;
  buyerSavedPercent: number;
  sellerSurplus: number;
  totalRounds: number;
  totalActions: number;
  humanMessagesCount: number;
  completedAt: string;
}

export interface NegotiationSession {
  id: string;
  threadId?: string;
  version?: number;
  listing: Listing;
  buyerPolicy: BuyerPolicy;
  sellerPolicy: SellerPolicy;
  buyerPrivateState: PrivateState;
  sellerPrivateState: PrivateState;
  offers: NegotiationOffer[];
  currentTurn: 'buyer' | 'seller';
  currentOfferPrice?: number;
  status: NegotiationStatus;
  waitingUntilHours?: number;
  waitingUntilAt?: string;
  simulationStep?: number;
  agentMemory?: NegotiationMemory;
  dealSummary?: DealSummary;
  createdAt: string;
  updatedAt: string;
}

/**
 * Client-safe view of a negotiation. Seller reservation values and agent
 * private state never cross this boundary.
 */
export interface PublicNegotiationSession {
  id: string;
  threadId: string;
  version: number;
  listing: Listing;
  buyerPolicy: BuyerPolicy;
  offers: NegotiationOffer[];
  currentTurn: 'buyer' | 'seller';
  currentOfferPrice?: number;
  status: NegotiationStatus;
  waitingUntilHours?: number;
  waitingUntilAt?: string;
  simulationStep?: number;
  agentMemory?: NegotiationMemory;
  dealSummary?: DealSummary;
  createdAt: string;
  updatedAt: string;
}

// LangGraph State Graph Definition
export interface GraphAssessment {
  estimatedMarketPrice: number;
  winProbability: number;
  riskOfLoss: number;
  batna: number;
  recommendation: AgentActionType;
  recommendedPrice: number;
  factors: string[];
}

export interface NegotiationGraphState {
  session: NegotiationSession;
  currentRole: 'buyer' | 'seller';
  currentListing: Listing;
  visibleOffers: NegotiationOffer[];
  privateReservationPrice: number;
  privateFlexibility: number;
  latestAssessment?: GraphAssessment;
  plannedAction?: AgentActionType;
  plannedPrice?: number;
  plannedWaitHours?: number;
  plannedTerms?: NegotiationTerms;
  plannedAlternatives?: AgentAlternative[];
  reasoningDetails?: ActionReasoning;
  isDeal: boolean;
  isTerminated: boolean;
  error?: string;
}

export type ApprovalTaskKind = 'reply' | 'contract';
export type ApprovalTaskStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalTask {
  id: string;
  negotiationId: string;
  kind: ApprovalTaskKind;
  status: ApprovalTaskStatus;
  title: string;
  payload: unknown;
  version: number;
  createdAt: string;
  resolvedAt?: string;
}

export type ContractDraftStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface PartySnapshot {
  id: string;
  name: string;
  role: 'buyer' | 'seller';
}

export interface ContractClause {
  id: string;
  title: string;
  body: string;
}

export interface ContractDraft {
  id: string;
  negotiationId: string;
  version: number;
  status: ContractDraftStatus;
  buyer: PartySnapshot;
  seller: PartySnapshot;
  listing: Listing;
  agreedPrice: number;
  totalAmount: number;
  terms: NegotiationTerms;
  clauses: ContractClause[];
  riskFlags: string[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

export interface AgentRunRecord {
  id: string;
  negotiationId: string;
  provider: 'google' | 'openai' | 'heuristic';
  model?: string;
  latencyMs: number;
  fallback: boolean;
  candidateCount: number;
  selectedCandidate: number;
  guardrailCorrections: number;
  createdAt: string;
}
