import { Listing, NegotiationTerms } from '@/types/negotiation';

const DEFAULT_PAYMENT_TERMS = '即時決済';
const DEFAULT_WARRANTY = '商品説明に準拠';

function parseDeliveryDays(shippingDays?: string) {
  if (!shippingDays) return 3;
  const values = shippingDays.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  return values.length > 0 ? Math.max(1, Math.max(...values)) : 3;
}

export function defaultNegotiationTerms(listing: Listing): NegotiationTerms {
  return {
    quantity: 1,
    currency: 'JPY',
    taxIncluded: true,
    shippingCost: 0,
    deliveryDays: parseDeliveryDays(listing.shippingDays),
    paymentTerms: DEFAULT_PAYMENT_TERMS,
    warranty: DEFAULT_WARRANTY,
    concessions: [],
  };
}

export function normalizeNegotiationTerms(
  listing: Listing,
  terms?: Partial<NegotiationTerms>
): NegotiationTerms {
  const defaults = defaultNegotiationTerms(listing);
  return {
    ...defaults,
    ...terms,
    quantity: Number.isInteger(terms?.quantity) ? Math.max(1, terms?.quantity as number) : defaults.quantity,
    currency: typeof terms?.currency === 'string' && terms.currency.trim()
      ? terms.currency.trim().toUpperCase()
      : defaults.currency,
    taxIncluded: typeof terms?.taxIncluded === 'boolean' ? terms.taxIncluded : defaults.taxIncluded,
    shippingCost: Number.isFinite(terms?.shippingCost) ? Math.max(0, Math.round(terms?.shippingCost as number)) : defaults.shippingCost,
    deliveryDays: Number.isInteger(terms?.deliveryDays) ? Math.max(1, terms?.deliveryDays as number) : defaults.deliveryDays,
    paymentTerms: typeof terms?.paymentTerms === 'string' && terms.paymentTerms.trim()
      ? terms.paymentTerms.trim()
      : defaults.paymentTerms,
    warranty: typeof terms?.warranty === 'string' && terms.warranty.trim()
      ? terms.warranty.trim()
      : defaults.warranty,
    expiresAt: typeof terms?.expiresAt === 'string' && terms.expiresAt.trim() ? terms.expiresAt.trim() : undefined,
    concessions: Array.isArray(terms?.concessions)
      ? terms.concessions.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 8)
      : defaults.concessions,
  };
}

export function totalOfferCost(price: number, terms: NegotiationTerms) {
  return Math.max(0, Math.round(price)) + Math.max(0, Math.round(terms.shippingCost));
}
