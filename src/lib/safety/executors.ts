import { canonicalJson, hmacHex } from '@/lib/safety/hash';
import type { EffectExecutor, IrreversibleIntent } from '@/lib/safety/commitGate';

export interface SandboxEffectRecord {
  effectId: string;
  intentHash: string;
  kind: string;
  subjectId: string;
  amount: number;
  currency: string;
  executedAt: string;
}

const sandboxState = globalThis as typeof globalThis & { __bargainSandboxEffects?: SandboxEffectRecord[] };
const sandboxEffects = (sandboxState.__bargainSandboxEffects ??= []);

/**
 * Default executor: records the effect in a process-local sandbox ledger.
 * It stands in for a payment/order system so the demo never moves money.
 */
export class SandboxEffectExecutor implements EffectExecutor {
  readonly name = 'sandbox';

  async execute(intent: IrreversibleIntent, context: { effectId: string; intentHash: string }) {
    sandboxEffects.push({
      effectId: context.effectId,
      intentHash: context.intentHash,
      kind: intent.kind,
      subjectId: intent.subjectId,
      amount: intent.amount,
      currency: intent.currency,
      executedAt: new Date().toISOString(),
    });
    return { externalRef: `sandbox:${context.effectId}` };
  }
}

export function getSandboxEffects(subjectId?: string) {
  return sandboxEffects.filter((effect) => !subjectId || effect.subjectId === subjectId).map((effect) => ({ ...effect }));
}

/**
 * Real external side effect: POSTs the approved intent to an order/payment
 * endpoint. The receiver gets an `Idempotency-Key` (the intent hash) and an
 * HMAC signature so it can verify and de-duplicate the call.
 */
export class WebhookEffectExecutor implements EffectExecutor {
  readonly name = 'webhook';

  constructor(
    private readonly url: string,
    private readonly signingSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000
  ) {}

  async execute(intent: IrreversibleIntent, context: { effectId: string; intentHash: string; idempotencyKey: string }) {
    const body = canonicalJson({ effectId: context.effectId, intentHash: context.intentHash, intent });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': context.idempotencyKey,
          'X-Bargain-Signature': `sha256=${hmacHex(this.signingSecret, body)}`,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`WEBHOOK_STATUS_${response.status}`);
      const reference = response.headers.get('x-order-reference') ?? undefined;
      return { externalRef: reference ? `webhook:${reference}` : `webhook:${context.effectId}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
