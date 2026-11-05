import type { ApprovalGrant, AuthorizationRequirement, EffectReceipt, IrreversibleIntent } from '@/lib/safety/commitGate';
import type { TranslationKey, TranslationParams } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/config';

/** A message stored as a dictionary key so it renders in the viewer's locale. */
export interface LocalizedMessage {
  key: TranslationKey;
  params?: TranslationParams;
}

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
  /** Structured form of `summary` for text the app generates itself. */
  summaryTemplate?: LocalizedMessage;
  /** Structured form of `factors`. */
  factorTemplates?: LocalizedMessage[];
  marketMedian: number;
  daysListed: number;
  demandTrend: string;
  /** Heuristic score, not a calibrated probability. */
  acceptanceScore: number;
  factors: string[];
}

/** Public, explainable metadata that can be shown in the audit trail. */
export interface NegotiationDecisionMetadata {
  guardrailCorrection?: string;
  /** Structured form of `guardrailCorrection`, when it has a single source. */
  guardrailCorrectionTemplates?: LocalizedMessage[];
  requiresHumanApproval?: boolean;
  approvalReason?: string;
  /** Structured form of `approvalReason`. */
  approvalReasonTemplate?: LocalizedMessage;
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
  /** Selected proposals use a deterministic public message tied to price/terms. */
  publicMessage?: string;
  targetOfferId?: string;
  targetOfferVersion?: number;
  waitHours?: number;
  source?: 'llm' | 'heuristic';
  score?: number;
  policyIssues?: string[];
  isValid?: boolean;
}

/** Atomic unit passed from planning to execution. */
export interface ActionProposal {
  id: string;
  action: AgentActionType;
  targetOfferId?: string;
  targetOfferVersion?: number;
  price: number;
  terms: NegotiationTerms;
  publicMessage: string;
  /** Structured form of `publicMessage`, so the UI can re-render it in any locale. */
  publicMessageTemplate?: LocalizedMessage;
  internalRationale: string;
  waitHours?: number;
  source: 'llm' | 'heuristic';
  risks: string[];
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
  /** Monotonic version of this offer for compare-and-accept semantics. */
  version?: number;
  /** Hash of the immutable public offer payload. */
  proposalHash?: string;
  targetOfferId?: string;
  targetOfferVersion?: number;
  round: number;
  timestamp: string;
  senderRole: 'buyer_agent' | 'seller_agent' | 'buyer_human' | 'seller_human';
  senderName: string;
  /** Present when `senderName` is a synthetic label the app can translate. */
  senderKey?: TranslationKey;
  price: number;
  terms?: NegotiationTerms;
  actionType: AgentActionType;
  reasoning?: ActionReasoning;
  decision?: NegotiationDecisionMetadata;
  alternatives?: AgentAlternative[];
  waitTimeHours?: number;
  /** Rendered text, kept for API clients and records written before i18n. */
  messageText: string;
  /** Structured form of `messageText`; preferred by the UI. */
  messageTemplate?: LocalizedMessage;
}

export type NegotiationStatus =
  | 'initializing'
  | 'active'
  | 'waiting'
  /** Both sides agreed; the irreversible purchase commitment has not run yet. */
  | 'awaiting_commit'
  | 'deal'
  | 'rejected'
  | 'paused_for_human';

/** Payload of the irreversible `purchase.commit` effect. Hashed into the intent. */
export interface PurchaseIntentPayload {
  negotiationId: string;
  agreementOfferId: string;
  acceptedOfferId?: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  price: number;
  terms: NegotiationTerms;
  total: number;
}

export interface PendingCommit {
  intent: IrreversibleIntent<PurchaseIntentPayload>;
  intentHash: string;
  requirement: AuthorizationRequirement;
  grants: ApprovalGrant[];
  createdAt: string;
  expiresAt: string;
  /** Why the gate refused to run the effect on the last attempt, if it did. */
  blockedReason?: string;
}

export interface RejectedCommit {
  intentHash: string;
  amount: number;
  reason: 'rejected' | 'expired';
  by?: string;
  at: string;
}

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

export type PublicBuyerPolicy = Omit<BuyerPolicy, 'targetPrice' | 'maxPrice' | 'autoApprovalMaxPrice'>;
export type PublicSellerPolicy = Omit<SellerPolicy, 'minPrice' | 'costPrice' | 'minimumProfit' | 'autoApprovalMinPrice'>;
export type PublicDealSummary = Omit<DealSummary, 'sellerSurplus'>;

/** The only offer shape safe to expose to an unauthenticated counterparty. */
export type CounterpartyPublicOffer = Pick<
  NegotiationOffer,
  | 'id'
  | 'version'
  | 'proposalHash'
  | 'targetOfferId'
  | 'targetOfferVersion'
  | 'round'
  | 'timestamp'
  | 'senderRole'
  | 'senderName'
  | 'senderKey'
  | 'price'
  | 'terms'
  | 'actionType'
  | 'waitTimeHours'
  | 'messageText'
  | 'messageTemplate'
>;

export type NegotiationOfferView = CounterpartyPublicOffer & Pick<
  NegotiationOffer,
  'reasoning' | 'decision' | 'alternatives'
>;

export interface NegotiationSession {
  id: string;
  threadId?: string;
  version?: number;
  buyerId: string;
  sellerId: string;
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
  pendingCommit?: PendingCommit;
  commitReceipt?: EffectReceipt;
  rejectedCommits?: RejectedCommit[];
  /** Scripted, in-memory demo session. Never persisted, never reaches the gate. */
  scriptedDemo?: boolean;
  /** Language the negotiation is conducted in; drives generated agent text. */
  locale?: Locale;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPendingCommit {
  intentHash: string;
  amount: number;
  currency: string;
  price: number;
  shippingCost: number;
  expiresAt: string;
  requiresHumanApproval: boolean;
  approvals: Array<{ role: string; granted: boolean }>;
  blockedReason?: string;
}

export interface PublicCommitReceipt {
  effectId: string;
  intentHash: string;
  amount: number;
  currency: string;
  executor: string;
  authorizationMode: 'policy' | 'human';
  executedAt: string;
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
  offers: NegotiationOfferView[];
  currentTurn: 'buyer' | 'seller';
  currentOfferPrice?: number;
  status: NegotiationStatus;
  waitingUntilHours?: number;
  waitingUntilAt?: string;
  simulationStep?: number;
  dealSummary?: PublicDealSummary;
  pendingCommit?: PublicPendingCommit;
  commitReceipt?: PublicCommitReceipt;
  /** Present only when the request is authenticated as the owner of this view. */
  viewer?: {
    actorId: string;
    role: 'buyer' | 'seller';
    policy: BuyerPolicy | SellerPolicy;
    agentMemory?: NegotiationMemory;
    /** True when this viewer's signed approval is still needed to commit. */
    mustApproveCommit?: boolean;
    commitApprovalReason?: string;
  };
  viewerDealSummary?: DealSummary;
  createdAt: string;
  updatedAt: string;
}

// LangGraph State Graph Definition
export interface GraphAssessment {
  estimatedMarketPrice: number;
  acceptanceScore: number;
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
  plannedTargetOfferId?: string;
  plannedTargetOfferVersion?: number;
  plannedWaitHours?: number;
  plannedTerms?: NegotiationTerms;
  plannedAlternatives?: AgentAlternative[];
  plannedProposal?: ActionProposal;
  reasoningDetails?: ActionReasoning;
  isDeal: boolean;
  isTerminated: boolean;
  error?: string;
}

/** `reply` is retired (pre-gate approvals); kept so old rows still parse. */
export type ApprovalTaskKind = 'reply' | 'contract' | 'commit';
export type ApprovalTaskStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalTask {
  id: string;
  negotiationId: string;
  ownerId: string;
  kind: ApprovalTaskKind;
  status: ApprovalTaskStatus;
  title: string;
  payload: unknown;
  subjectType: 'offer' | 'contract' | 'commit';
  subjectId: string;
  subjectVersion: number;
  proposalHash: string;
  requestedBy: string;
  expiresAt: string;
  version: number;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
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
  /** Dictionary keys for the rendered strings, so the UI can re-localise. */
  titleKey?: TranslationKey;
  bodyKey?: TranslationKey;
  params?: TranslationParams;
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
  provider: 'google' | 'openai' | 'opencode' | 'heuristic';
  model?: string;
  latencyMs: number;
  fallback: boolean;
  candidateCount: number;
  selectedCandidate: number;
  guardrailCorrections: number;
  createdAt: string;
}
