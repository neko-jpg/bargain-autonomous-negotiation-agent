import { z } from 'zod';

const integerYen = z.number().finite().int().min(0).max(10_000_000_000);
const positiveInteger = z.number().finite().int().min(1).max(1_000_000);

export const NegotiationTermsInputSchema = z.object({
  quantity: positiveInteger,
  currency: z.string().trim().min(3).max(8),
  taxIncluded: z.boolean(),
  shippingCost: integerYen,
  deliveryDays: positiveInteger.max(365),
  paymentTerms: z.string().trim().min(1).max(80),
  warranty: z.string().trim().min(1).max(160),
  expiresAt: z.string().trim().max(80).optional(),
  concessions: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
});

export const BuyerPolicyInputSchema = z
  .object({
    targetPrice: integerYen,
    maxPrice: integerYen,
    deadlineDays: z.number().finite().int().min(1).max(30),
    autoPurchase: z.boolean(),
    autoNegotiate: z.boolean().optional(),
    maxDeliveryDays: z.number().finite().int().min(1).max(365).optional(),
    maxShippingCost: integerYen.optional(),
    minQuantity: positiveInteger.optional(),
    requiredCurrency: z.string().trim().min(3).max(8).optional(),
    requireTaxIncluded: z.boolean().optional(),
    allowedPaymentTerms: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    autoApprovalMaxPrice: integerYen.optional(),
  })
  .superRefine((policy, ctx) => {
    if (policy.targetPrice > policy.maxPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetPrice'],
        message: '目標価格は上限価格以下にしてください。',
      });
    }
  });

export const CreateNegotiationRequestSchema = z.object({
  listingId: z.string().min(1),
  buyerPolicy: BuyerPolicyInputSchema.optional(),
  buyerTerms: NegotiationTermsInputSchema.optional(),
});

const versionedAction = z.object({
  expectedVersion: z.number().finite().int().min(0),
  idempotencyKey: z.string().min(8).max(120),
});

export const NegotiationActionRequestSchema = z.discriminatedUnion('type', [
  versionedAction.extend({ type: z.literal('auto_step') }),
  versionedAction.extend({
    type: z.literal('time_skip'),
    waitHours: z.number().finite().int().min(1).max(72),
  }),
  versionedAction.extend({
    type: z.literal('human_offer'),
    offerPrice: integerYen,
    messageText: z.string().trim().min(1).max(280).optional(),
    terms: NegotiationTermsInputSchema.optional(),
  }),
  versionedAction.extend({
    type: z.literal('human_accept'),
    targetOfferId: z.string().trim().min(1).max(160),
    targetOfferVersion: z.number().finite().int().min(1).optional(),
  }),
  versionedAction.extend({ type: z.literal('human_reject') }),
  versionedAction.extend({ type: z.literal('pause') }),
  versionedAction.extend({ type: z.literal('resume') }),
  versionedAction.extend({ type: z.literal('stop') }),
  versionedAction.extend({
    type: z.literal('update_policy'),
    buyerPolicy: BuyerPolicyInputSchema,
  }),
  // Commit actions are bound to the exact intent hash the human saw, not to
  // the session version, so a concurrent unrelated update cannot void them.
  versionedAction.extend({ type: z.literal('approve_commit'), intentHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  versionedAction.extend({ type: z.literal('reject_commit'), intentHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  versionedAction.extend({ type: z.literal('retry_commit') }),
  // Operator records what they verified with the payment provider for an
  // attempt whose outcome the gate could not observe. Never runs the effect.
  versionedAction.extend({
    type: z.literal('reconcile_commit'),
    intentHash: z.string().regex(/^[0-9a-f]{64}$/),
    outcome: z.enum(['executed', 'not_executed']),
    externalRef: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().min(5).max(500),
  }),
]);

export type CreateNegotiationRequest = z.infer<typeof CreateNegotiationRequestSchema>;
export type NegotiationActionRequest = z.infer<typeof NegotiationActionRequestSchema>;
