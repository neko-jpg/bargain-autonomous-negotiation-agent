import { BuyerPolicy, Listing, SellerPolicy } from '@/types/negotiation';
import { CATALOG_LISTINGS, DEMO_CATALOG_ID } from '@/lib/catalog/catalogAdapter';

/**
 * Compatibility export for the negotiation demo. The source of truth is the
 * curated 50-item catalog synced from メルカリUI_kit, not hand-written mock rows.
 */
export const INITIAL_LISTINGS: Listing[] = CATALOG_LISTINGS;

const roundToHundred = (value: number) => Math.round(value / 100) * 100;
const demoListing = CATALOG_LISTINGS.find((listing) => listing.id === DEMO_CATALOG_ID) ?? CATALOG_LISTINGS[0];

export const DEFAULT_BUYER_POLICY_DEMO: BuyerPolicy = {
  targetPrice: roundToHundred(demoListing.price * 0.84),
  maxPrice: roundToHundred(demoListing.price * 0.92),
  deadlineDays: 3,
  autoPurchase: true,
  autoNegotiate: true,
  delegationLevel: 3,
  maxDeliveryDays: 7,
  maxShippingCost: 0,
  minQuantity: 1,
  requiredCurrency: 'JPY',
  requireTaxIncluded: true,
  allowedPaymentTerms: ['即時決済'],
};

export const DEFAULT_SELLER_POLICY_DEMO: SellerPolicy = {
  targetPrice: roundToHundred(demoListing.price * 0.96),
  minPrice: roundToHundred(demoListing.price * 0.88),
  urgency: 'medium',
  deadlineDays: 7,
  autoAccept: true,
  costPrice: roundToHundred(demoListing.price * 0.78),
  minimumProfit: roundToHundred(demoListing.price * 0.10),
  minQuantity: 1,
  maxDeliveryDays: 7,
  maxShippingCost: 0,
  requiredCurrency: 'JPY',
  requireTaxIncluded: true,
  allowedPaymentTerms: ['即時決済'],
};

// Kept as a non-breaking alias for existing test fixtures and API clients.
export const DEFAULT_BUYER_POLICY_SWITCH = DEFAULT_BUYER_POLICY_DEMO;
export const DEFAULT_SELLER_POLICY_SWITCH = DEFAULT_SELLER_POLICY_DEMO;
