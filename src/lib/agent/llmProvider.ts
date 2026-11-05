import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { AgentAlternative, Listing, AgentActionType, ActionReasoning, NegotiationOffer, NegotiationTerms, NegotiationMemory } from '@/types/negotiation';
import { normalizeNegotiationTerms } from '@/lib/negotiation/terms';
import { PROMPT_DATA_BOUNDARY, promptVisibleHistory, promptVisibleMemory, singleLine } from '@/lib/agent/promptSafety';
import { isProductionEnvironment } from '@/lib/runtime/environment';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';

export interface AgentPlanningResult {
  action: AgentActionType;
  price: number;
  targetOfferId?: string;
  targetOfferVersion?: number;
  waitHours?: number;
  reasoning: ActionReasoning;
  explanationMessage: string;
  terms?: NegotiationTerms;
  alternatives: AgentAlternative[];
  telemetry: {
    provider: 'google' | 'openai' | 'opencode' | 'heuristic';
    model?: string;
    fallback: boolean;
  };
}

type LLMProviderName = 'google' | 'openai' | 'opencode' | 'auto';

export interface PlannerInput {
  role: 'buyer' | 'seller';
  listing: Listing;
  targetPrice: number;
  reservationPrice: number;
  history: NegotiationOffer[];
}

type PlannerOverride = (input: PlannerInput) => AgentPlanningResult | Promise<AgentPlanningResult>;
let plannerOverride: PlannerOverride | undefined;

/**
 * Test hook: replace the model with an arbitrary (e.g. adversarial) planner.
 * The safety suite uses it to prove guardrails hold whatever the LLM returns.
 */
export function setAgentPlannerForTesting(override: PlannerOverride | undefined) {
  if (isProductionEnvironment()) throw new Error('TEST_HOOK_DISABLED_IN_PRODUCTION');
  plannerOverride = override;
}

type PromptOverride = (input: PlannerUserPromptInput) => string;
let promptOverride: PromptOverride | undefined;

/**
 * Test hook for the red team only: replace the hardened user prompt with an
 * unprotected one that carries counterparty free text. It exists to measure how
 * far a real model can be hijacked when the inbound defence is removed, so the
 * gate can be shown to hold anyway. It never ships enabled.
 */
export function setPlannerPromptForTesting(override: PromptOverride | undefined) {
  if (isProductionEnvironment()) throw new Error('TEST_HOOK_DISABLED_IN_PRODUCTION');
  promptOverride = override;
}

type PlanObserver = (info: { history: NegotiationOffer[]; result: AgentPlanningResult }) => void;
let planObserver: PlanObserver | undefined;

/** Test hook: sees the model's raw plan before any guardrail touches it. */
export function setPlanObserverForTesting(observer: PlanObserver | undefined) {
  if (isProductionEnvironment()) throw new Error('TEST_HOOK_DISABLED_IN_PRODUCTION');
  planObserver = observer;
}

const isUsableApiKey = (value: string | undefined): value is string => {
  if (!value) return false;
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  return normalized.length > 0 && !/^(your_|placeholder|replace_me|change_me)/i.test(normalized);
};

/** A hung provider must not stall the negotiation turn. */
const LLM_TIMEOUT_MS = (() => {
  const configured = Number(process.env.BARGAIN_LLM_TIMEOUT_MS);
  // Reasoning models can think for tens of seconds before emitting anything, so
  // the default is generous but still bounded.
  return Number.isFinite(configured) && configured >= 1_000 && configured <= 120_000 ? configured : 45_000;
})();
/**
 * Bounded output keeps a verbose or looping model from burning the turn. It is
 * generous because reasoning models spend tokens before they emit anything, and
 * a cap that only covers the thinking produces an empty answer.
 */
const LLM_MAX_OUTPUT_TOKENS = (() => {
  const configured = Number(process.env.BARGAIN_LLM_MAX_TOKENS);
  // 2k is not enough for a reasoning model that must also emit the full plan:
  // the thinking is billed against the same budget and the JSON gets cut.
  return Number.isFinite(configured) && configured >= 256 && configured <= 16_384 ? configured : 4_096;
})();
/**
 * Stable per-process routing id for OpenCode Go. The gateway asks for one so it
 * can route a conversation to the same upstream; without it every call is
 * answered with MissingSessionID.
 */
const opencodeSessionId = `bargain-${globalThis.crypto.randomUUID().slice(0, 12)}`;

export interface PlannerUserPromptInput {
  history: NegotiationOffer[];
  lastOpponentOffer?: NegotiationOffer;
  acceptanceScore: number;
  memory?: NegotiationMemory;
  /** Language of the negotiation; English prompts produce English reasoning. */
  locale?: Locale;
}

/** English counterpart of the Japanese planner user prompt below. */
function buildEnglishPlannerUserPrompt(input: PlannerUserPromptInput): string {
  const { history, lastOpponentOffer, acceptanceScore, memory } = input;
  return `Current negotiation history: ${JSON.stringify(promptVisibleHistory(history))}
Latest counterparty offer: ${lastOpponentOffer ? `¥${lastOpponentOffer.price.toLocaleString()}` : 'none yet'}
Acceptance score (not a calibrated probability): ${acceptanceScore}
Prior negotiation notes: ${JSON.stringify(promptVisibleMemory(memory))}

${PROMPT_DATA_BOUNDARY}

Decide the best action and amount.`;
}

interface PlannerPromptContext {
  role: 'buyer' | 'seller';
  listing: Listing;
  targetPrice: number;
  reservationPrice: number;
  batna: number;
}

/** English counterpart of the Japanese system prompt below. */
function buildEnglishPlannerSystemPrompt(context: PlannerPromptContext): string {
  const { role, listing, targetPrice, reservationPrice, batna } = context;
  return `You are "Project BARGAIN", an autonomous price-negotiation agent on a C2C marketplace.
Role: ${role === 'buyer' ? 'Buyer Agent' : 'Seller Agent'}
Item: ${singleLine(listing.title, 80)} (list price: ¥${listing.price.toLocaleString()}, market median: ¥${listing.marketMedianPrice.toLocaleString()})
Days listed: ${listing.daysListed}, likes: ${listing.likesCount}, demand: ${listing.recentDemand}
Your target price: ¥${targetPrice.toLocaleString()}
Your reservation price (Private State): ¥${reservationPrice.toLocaleString()} (${role === 'buyer' ? 'never exceed this amount' : 'never go below this amount'})
Current BATNA (best alternative price): ¥${batna.toLocaleString()}

Strict confidentiality rules:
- explanationMessage is sent to the counterparty verbatim, so never include Private State, target price, reservation price, BATNA, win rate, or internal reasoning.
- Only state the offered amount and publicly shareable terms.

Choose one of the actions below and answer with valid JSON only.
In addition to the primary plan, return up to three alternatives with a different price or terms:
{
  "action": "make_offer" | "counter_offer" | "accept_offer" | "reject_offer" | "wait",
  "price": number,
  "waitHours": number (only when action is "wait", 1-48),
  "summaryReason": string (short reason for the decision),
  "factors": string[] (3-4 factors behind the decision),
  "explanationMessage": string (polite message sent to the counterparty),
  "terms": {
    "quantity": number,
    "currency": string,
    "taxIncluded": boolean,
    "shippingCost": number,
    "deliveryDays": number,
    "paymentTerms": string,
    "warranty": string,
    "expiresAt": string,
    "concessions": string[]
  },
  "alternatives": [
    { "action": "counter_offer", "price": number, "rationale": string, "confidence": 0.0, "risks": string[], "terms": { ... } }
  ]
}`;
}

/**
 * Pure. The whole user turn is assembled from allowlisted structural fields so
 * the safety suite can assert exactly what reaches the model — and, more
 * importantly, what cannot.
 */
export function buildPlannerUserPrompt(input: PlannerUserPromptInput): string {
  if (input.locale === 'en') return buildEnglishPlannerUserPrompt(input);
  const { history, lastOpponentOffer, acceptanceScore, memory } = input;
  return `現在の交渉履歴: ${JSON.stringify(promptVisibleHistory(history))}
直近の相手提示: ${lastOpponentOffer ? `¥${lastOpponentOffer.price.toLocaleString()}` : 'まだなし'}
受諾スコア（統計的に校正された確率ではない）: ${acceptanceScore}
過去の交渉メモ: ${JSON.stringify(promptVisibleMemory(memory))}

${PROMPT_DATA_BOUNDARY}

最適なアクションと金額を決定してください。`;
}

const AgentPlanSchema = z.object({
  action: z.enum(['make_offer', 'counter_offer', 'accept_offer', 'reject_offer', 'wait', 'ask_user']),
  price: z.number().finite().int().nonnegative(),
  targetOfferId: z.string().min(1).max(160).optional(),
  targetOfferVersion: z.number().finite().int().min(1).optional(),
  waitHours: z.number().finite().int().min(1).max(72).optional(),
  summaryReason: z.string().min(1).max(300),
  factors: z.array(z.string().min(1).max(120)).min(1).max(6),
  explanationMessage: z.string().min(1).max(280),
  terms: z.object({
    quantity: z.number().finite().int().min(1).max(1_000_000),
    currency: z.string().min(3).max(8),
    taxIncluded: z.boolean(),
    shippingCost: z.number().finite().int().min(0).max(10_000_000_000),
    deliveryDays: z.number().finite().int().min(1).max(365),
    paymentTerms: z.string().min(1).max(80),
    warranty: z.string().min(1).max(160),
    expiresAt: z.string().max(80).optional(),
    concessions: z.array(z.string().min(1).max(120)).max(8),
  }).optional(),
  alternatives: z.array(z.object({
    action: z.enum(['make_offer', 'counter_offer', 'accept_offer', 'reject_offer', 'wait', 'ask_user']),
    price: z.number().finite().int().nonnegative().optional(),
    waitHours: z.number().finite().int().min(1).max(72).optional(),
    rationale: z.string().min(1).max(240),
    confidence: z.number().finite().min(0).max(1),
    risks: z.array(z.string().min(1).max(120)).max(5),
    terms: z.object({
      quantity: z.number().finite().int().min(1).max(1_000_000),
      currency: z.string().min(3).max(8),
      taxIncluded: z.boolean(),
      shippingCost: z.number().finite().int().min(0).max(10_000_000_000),
      deliveryDays: z.number().finite().int().min(1).max(365),
      paymentTerms: z.string().min(1).max(80),
      warranty: z.string().min(1).max(160),
      expiresAt: z.string().max(80).optional(),
      concessions: z.array(z.string().min(1).max(120)).max(8),
    }).optional(),
  })).max(4).optional(),
});

export class LLMProviderService {
  private static getProviderPreference(): LLMProviderName {
    const configured = process.env.BARGAIN_LLM_PROVIDER?.trim().toLowerCase();
    return configured === 'google' || configured === 'openai' || configured === 'opencode' ? configured : 'auto';
  }

  private static getModel(): { model: BaseChatModel; provider: 'google' | 'openai' | 'opencode'; modelName: string } | null {
    const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const provider = this.getProviderPreference();
    const candidates: Array<'google' | 'openai' | 'opencode'> = provider === 'google'
      ? ['google']
      : provider === 'openai'
        ? ['openai']
        : provider === 'opencode'
          ? ['opencode']
          : ['google', 'openai', 'opencode'];

    for (const candidate of candidates) {
      if (candidate === 'google' && isUsableApiKey(googleApiKey)) {
        try {
          const modelName = process.env.BARGAIN_GOOGLE_MODEL || 'gemini-3.6-flash';
          return { model: new ChatGoogleGenerativeAI({
            apiKey: googleApiKey,
            // Older Gemini Flash models are no longer available to this API key.
            // Keep the model configurable, but use a current stable model by default.
            model: modelName,
            temperature: 0.2,
            maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
            maxRetries: 1,
          }), provider: 'google', modelName };
        } catch (e) {
          console.warn('Gemini client initialization failed, fallback to heuristic engine:', e);
        }
      }

      if (candidate === 'openai' && isUsableApiKey(process.env.OPENAI_API_KEY)) {
        try {
          const modelName = process.env.BARGAIN_OPENAI_MODEL || 'gpt-4o-mini';
          return { model: new ChatOpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            modelName,
            temperature: 0.2,
            maxTokens: LLM_MAX_OUTPUT_TOKENS,
            maxRetries: 1,
          }), provider: 'openai', modelName };
        } catch (e) {
          console.warn('OpenAI client initialization failed, fallback to heuristic engine:', e);
        }
      }

      if (candidate === 'opencode' && isUsableApiKey(process.env.OPENCODE_API_KEY)) {
        try {
          const modelName = process.env.BARGAIN_OPENCODE_MODEL?.trim();
          if (!modelName) throw new Error('BARGAIN_OPENCODE_MODEL is required; run `npm run provider:check` to list model ids');
          // OpenCode routes Go traffic on /inference/go/v1 and requires a stable
          // session id so requests for one conversation hit the same upstream.
          const baseURL = (process.env.OPENCODE_BASE_URL?.trim() || 'https://opencode.ai/inference/go/v1').replace(/\/$/, '');
          const session = process.env.OPENCODE_SESSION_ID?.trim() || opencodeSessionId;
          // Reasoning dominates latency on this gateway. `low` keeps the plan
          // coherent while cutting the thinking time; anything else is ignored
          // by the model, so only offer values it honours.
          const effort = process.env.BARGAIN_LLM_REASONING_EFFORT?.trim().toLowerCase();
          const reasoning = effort === 'low' || effort === 'medium' || effort === 'high' ? effort : undefined;
          return {
            model: new ChatOpenAI({
              apiKey: process.env.OPENCODE_API_KEY,
              modelName,
              temperature: 0.2,
              maxTokens: LLM_MAX_OUTPUT_TOKENS,
              maxRetries: 1,
              ...(reasoning ? { modelKwargs: { reasoning_effort: reasoning } } : {}),
              configuration: { baseURL, defaultHeaders: { 'x-opencode-session': session } },
            }),
            provider: 'opencode',
            modelName,
          };
        } catch (e) {
          console.warn('OpenCode client initialization failed, fallback to heuristic engine:', e);
        }
      }
    }

    return null;
  }

  /**
   * LLMまたはヒューリスティック戦略エンジンを用いて次のアクションと提示額を立案する
   */
  static async planNextAction(
    role: 'buyer' | 'seller',
    listing: Listing,
    targetPrice: number,
    reservationPrice: number,
    urgency: 'low' | 'medium' | 'high',
    history: NegotiationOffer[],
    acceptanceScore: number,
    batna: number,
    baseTerms?: Partial<NegotiationTerms>,
    memory?: NegotiationMemory,
    locale: Locale = DEFAULT_LOCALE
  ): Promise<AgentPlanningResult> {
    if (plannerOverride) return plannerOverride({ role, listing, targetPrice, reservationPrice, history });
    const configuredModel = this.getModel();
    const model = configuredModel?.model;

    // LLMが利用可能な場合はLLMに構造化プロンプトで推論を依頼
    if (model) {
      try {
        const lastOpponentOffer = [...history]
          .reverse()
          .find((o) => (role === 'buyer' ? o.senderRole.includes('seller') : o.senderRole.includes('buyer')));

        const systemPrompt = locale === 'en'
          ? buildEnglishPlannerSystemPrompt({ role, listing, targetPrice, reservationPrice, batna })
          : `あなたはC2Cマーケットプレイスにおける自律型価格交渉AIエージェント「Project BARGAIN」です。
役割: ${role === 'buyer' ? '買い手代理 (Buyer Agent)' : '売り手代理 (Seller Agent)'}
商品: ${singleLine(listing.title, 80)} (出品価格: ¥${listing.price.toLocaleString()}, 相場中央値: ¥${listing.marketMedianPrice.toLocaleString()})
出品経過日数: ${listing.daysListed}日, いいね数: ${listing.likesCount}, 需要: ${listing.recentDemand}
あなたの目標価格: ¥${targetPrice.toLocaleString()}
あなたの許容限界価格(Private State): ¥${reservationPrice.toLocaleString()} (${role === 'buyer' ? 'この金額を超えてはいけません' : 'この金額を下回ってはいけません'})
現在のBATNA(最善代替価格): ¥${batna.toLocaleString()}

重要な秘匿ルール:
- explanationMessageは相手にそのまま送信されるため、Private State、目標価格、許容限界価格、BATNA、勝率、内部の判断理由を記載しないこと。
- 相手に伝えるのは、今回の提示額と公開可能な条件だけにすること。

次のいずれかのアクションを選択し、有効なJSON形式でのみ回答してください。
主案に加えて、異なる価格または条件の代替案を最大3つ返してください:
{
  "action": "make_offer" | "counter_offer" | "accept_offer" | "reject_offer" | "wait",
  "price": number,
  "waitHours": number (actionが"wait"の場合のみ1〜48),
  "summaryReason": string (簡潔な判断理由),
  "factors": string[] (判断に影響した3〜4個の要因),
  "explanationMessage": string (相手に送信する丁寧なメッセージ),
  "terms": {
    "quantity": number,
    "currency": string,
    "taxIncluded": boolean,
    "shippingCost": number,
    "deliveryDays": number,
    "paymentTerms": string,
    "warranty": string,
    "expiresAt": string,
    "concessions": string[]
  },
  "alternatives": [
    { "action": "counter_offer", "price": number, "rationale": string, "confidence": 0.0, "risks": string[], "terms": { ... } }
  ]
}`;

        const userPrompt = (promptOverride ?? buildPlannerUserPrompt)({ history, lastOpponentOffer, acceptanceScore, memory, locale });

        // OpenAI's strict schema mode rejects `.optional()` without
        // `.nullable()`, and some gateways reject the dialect outright. The
        // OpenCode gateway is one of them, so it is driven as plain text.
        const supportsStructuredOutput = configuredModel?.provider !== 'opencode'
          && typeof (model as any).withStructuredOutput === 'function';
        const structuredModel = supportsStructuredOutput
          ? (model as any).withStructuredOutput(AgentPlanSchema, { name: 'negotiation_plan' })
          : undefined;

        const messages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ];

        let response;
        try {
          response = await (structuredModel ?? model).invoke(messages, { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) });
        } catch (error) {
          if (!structuredModel) throw error;
          // Some OpenAI-compatible gateways cannot translate the schema into
          // their response_format dialect. Retry once as plain text; the parser
          // below already accepts fenced or bare JSON.
          console.warn('structured output unsupported by this provider, retrying as plain text:', (error as Error).message);
          response = await model.invoke(messages, { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) });
        }

        const rawResponse = response && typeof response === 'object' && !('content' in response)
          ? response
          : (() => {
              const meta = (response as { response_metadata?: { finish_reason?: string } }).response_metadata;
              const text = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);
              const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
              if (!unfenced) {
                throw new Error(`empty model output (finish_reason=${meta?.finish_reason ?? 'unknown'})`);
              }
              try {
                return JSON.parse(unfenced);
              } catch {
                // A truncated answer is the common failure: the reply stops
                // mid-string. Say so, with the head of what arrived.
                throw new Error(`model output was not complete JSON (finish_reason=${meta?.finish_reason ?? 'unknown'}, ${unfenced.length} chars): ${unfenced.slice(0, 120)}`);
              }
            })();
        const parsedResult = AgentPlanSchema.safeParse(rawResponse);
        if (parsedResult.success) {
          const parsed = parsedResult.data;
          const planned: AgentPlanningResult = {
            action: parsed.action,
            price: parsed.price,
            targetOfferId: parsed.targetOfferId,
            targetOfferVersion: parsed.targetOfferVersion,
            waitHours: parsed.waitHours,
            reasoning: {
              summary: parsed.summaryReason,
              marketMedian: listing.marketMedianPrice,
              daysListed: listing.daysListed,
              demandTrend: listing.recentDemand,
              acceptanceScore,
              factors: parsed.factors,
            },
            explanationMessage: parsed.explanationMessage,
            terms: normalizeNegotiationTerms(listing, parsed.terms ?? baseTerms),
            alternatives: [
              {
                action: parsed.action,
                price: parsed.price,
                targetOfferId: parsed.targetOfferId,
                targetOfferVersion: parsed.targetOfferVersion,
                terms: normalizeNegotiationTerms(listing, parsed.terms ?? baseTerms),
                rationale: parsed.summaryReason,
                confidence: 0.7,
                risks: [],
              },
              ...(parsed.alternatives ?? []).map((alternative) => ({
                action: alternative.action,
                price: alternative.price,
                terms: normalizeNegotiationTerms(listing, alternative.terms ?? parsed.terms ?? baseTerms),
                rationale: alternative.rationale,
                confidence: alternative.confidence,
                risks: alternative.risks,
              })),
            ],
            telemetry: {
              provider: configuredModel?.provider ?? 'heuristic',
              model: configuredModel?.modelName,
              fallback: false,
            },
          };
          planObserver?.({ history, result: planned });
          return planned;
        }
      } catch (err) {
        console.warn('LLM inference encountered an issue, falling back to autonomous strategy engine:', err);
      }
    }

    // フォールバック: ゲーム理論・市場動向に基づく自律戦略エンジン
    const heuristic = this.autonomousStrategyHeuristic(
      role,
      listing,
      targetPrice,
      reservationPrice,
      urgency,
      history,
      acceptanceScore
    );
    return {
      ...heuristic,
      alternatives: this.buildHeuristicAlternatives(heuristic, role, listing, targetPrice, reservationPrice),
      telemetry: {
        provider: 'heuristic',
        fallback: Boolean(configuredModel),
      },
    };
  }

  private static buildHeuristicAlternatives(
    primary: Omit<AgentPlanningResult, 'alternatives' | 'telemetry'>,
    role: 'buyer' | 'seller',
    listing: Listing,
    targetPrice: number,
    reservationPrice: number
  ): AgentAlternative[] {
    const basePrice = primary.price;
    const steps = role === 'buyer' ? [-500, 500] : [500, -500];
    return [
      {
        action: primary.action,
        price: basePrice,
        terms: primary.terms,
        rationale: primary.reasoning.summary,
        confidence: 0.68,
        risks: [],
      },
      ...steps.map((step) => ({
        action: primary.action === 'accept_offer' ? 'counter_offer' as const : primary.action,
        price: Math.min(
          Math.max(0, role === 'buyer' ? Math.min(reservationPrice, basePrice + step) : Math.max(reservationPrice, basePrice + step)),
          listing.price * (role === 'buyer' ? 1 : 2)
        ),
        terms: primary.terms,
        rationale: `${primary.reasoning.summary}（代替案）`,
        confidence: 0.5,
        risks: [role === 'buyer' && targetPrice < basePrice ? '目標価格を上回る可能性' : '成約速度が変わる可能性'],
      })),
    ];
  }

  /**
   * 自律型交渉戦略エンジン（決定論的ヒューリスティック）
   */
  private static autonomousStrategyHeuristic(
    role: 'buyer' | 'seller',
    listing: Listing,
    targetPrice: number,
    reservationPrice: number,
    urgency: 'low' | 'medium' | 'high',
    history: NegotiationOffer[],
    acceptanceScore: number
  ): Omit<AgentPlanningResult, 'alternatives' | 'telemetry'> {
    const lastOpponentOffer = [...history]
      .reverse()
      .find((o) => (role === 'buyer' ? o.senderRole.includes('seller') : o.senderRole.includes('buyer')));

    const round = history.length + 1;

    if (role === 'buyer') {
      // 買い手エージェントの戦略
      if (lastOpponentOffer) {
        // 相手（売り手）のオファーが自身の許容上限以下ならACCEPT可能か判定
        if (lastOpponentOffer.price <= reservationPrice) {
          // 目標価格に近いか、または期限間近/需要が高いなら即受諾
          if (lastOpponentOffer.price <= targetPrice * 1.05 || listing.recentDemand === 'high' || round >= 5) {
            return {
              action: 'accept_offer',
              price: lastOpponentOffer.price,
              reasoning: {
                summary: `相手の提示額(¥${lastOpponentOffer.price.toLocaleString()})が上限価格(¥${reservationPrice.toLocaleString()})以内のため合意`,
                marketMedian: listing.marketMedianPrice,
                daysListed: listing.daysListed,
                demandTrend: listing.recentDemand,
                acceptanceScore: 95,
                factors: [
                  `上限価格 ¥${reservationPrice.toLocaleString()} を遵守`,
                  `相場中央値との差: ${Math.round(((lastOpponentOffer.price - listing.marketMedianPrice) / listing.marketMedianPrice) * 100)}%`,
                  '早期購入による他ユーザー奪取リスクの回避',
                ],
              },
              explanationMessage: `提示いただいた¥${lastOpponentOffer.price.toLocaleString()}で購入させていただきます。よろしくお願いいたします。`,
            };
          }
        }

        // 直前の相手提示に対して、歩み寄り幅を計算
        // 需要が低く出品期間が長い場合、相手が譲歩するのを「待つ(WAIT)」戦略
        const lastOwnOffer = [...history].reverse().find((o) => o.senderRole.includes('buyer'));
        const isStalled = lastOwnOffer && Math.abs(lastOpponentOffer.price - lastOwnOffer.price) > 2000;

        if (isStalled && listing.daysListed > 10 && listing.recentDemand !== 'high' && round === 3) {
          return {
            action: 'wait',
            price: lastOwnOffer.price,
            waitHours: 12,
            reasoning: {
              summary: '出品経過期間と需要低下を考慮し、売り手の譲歩を待機(WAIT)',
              marketMedian: listing.marketMedianPrice,
              daysListed: listing.daysListed,
              demandTrend: listing.recentDemand,
              acceptanceScore,
              factors: [
                `出品から${listing.daysListed}日経過しており売り手の値下げインセンティブが高い`,
                '直近需要が落ち着いているため即座に買い手が現れるリスクが低い',
                '即座に上限まで引き上げず、待機による条件改善を狙う',
              ],
            },
            explanationMessage: `現在状況を観測中です（最大12時間待機）。売り手の需要動向に合わせて再提案します。`,
          };
        }

        // カウンターオファーの算出
        const stepRatio = round <= 2 ? 0.35 : 0.65;
        const offerGap = Math.min(reservationPrice, lastOpponentOffer.price) - (lastOwnOffer ? lastOwnOffer.price : targetPrice);
        const nextPrice = Math.min(
          reservationPrice,
          Math.round(((lastOwnOffer ? lastOwnOffer.price : targetPrice) + offerGap * stepRatio) / 100) * 100
        );

        return {
          action: 'counter_offer',
          price: nextPrice,
          reasoning: {
            summary: `相場中央値(¥${listing.marketMedianPrice.toLocaleString()})を考慮し¥${nextPrice.toLocaleString()}をカウンター提示`,
            marketMedian: listing.marketMedianPrice,
            daysListed: listing.daysListed,
            demandTrend: listing.recentDemand,
                acceptanceScore,
            factors: [
              `市場相場 ¥${listing.marketMedianPrice.toLocaleString()} との乖離を調整`,
              `出品期間: ${listing.daysListed}日経過`,
              `上限 ¥${reservationPrice.toLocaleString()} 未満での成約を模索`,
            ],
          },
          explanationMessage: `ご検討ありがとうございます。間を取って¥${nextPrice.toLocaleString()}ではいかがでしょうか？即購入可能です。`,
        };
      } else {
        // 初回オファー
        // 需要が強ければ高め、低ければ安めから開始
        const initialDiscountRatio = listing.recentDemand === 'high' ? 0.92 : 0.86;
        const initialOffer = Math.max(
          targetPrice,
          Math.round((listing.price * initialDiscountRatio) / 100) * 100
        );
        const safeOffer = Math.min(reservationPrice, initialOffer);

        return {
          action: 'make_offer',
          price: safeOffer,
          reasoning: {
            summary: `初回提示額として¥${safeOffer.toLocaleString()}を提案`,
            marketMedian: listing.marketMedianPrice,
            daysListed: listing.daysListed,
            demandTrend: listing.recentDemand,
            acceptanceScore,
            factors: [
              `市場中央値 ¥${listing.marketMedianPrice.toLocaleString()} を基準に算出`,
              `出品価格 ¥${listing.price.toLocaleString()} からの適正ディスカウント`,
              `目標価格 ¥${targetPrice.toLocaleString()} を意識した初手`,
            ],
          },
          explanationMessage: `はじめまして。こちらの商品を¥${safeOffer.toLocaleString()}でお譲りいただくことは可能でしょうか？`,
        };
      }
    } else {
      // 売り手エージェントの戦略
      if (lastOpponentOffer) {
        // 相手提示が最低許容価格以上であれば合意検討
        if (lastOpponentOffer.price >= reservationPrice) {
          if (lastOpponentOffer.price >= targetPrice || urgency === 'high' || round >= 5) {
            return {
              action: 'accept_offer',
              price: lastOpponentOffer.price,
              reasoning: {
                summary: `買い手の提示額(¥${lastOpponentOffer.price.toLocaleString()})が最低許容価格(¥${reservationPrice.toLocaleString()})以上のため受諾`,
                marketMedian: listing.marketMedianPrice,
                daysListed: listing.daysListed,
                demandTrend: listing.recentDemand,
                acceptanceScore: 95,
                factors: [
                  `最低許容価格 ¥${reservationPrice.toLocaleString()} を確保`,
                  `売却優先度(${urgency === 'high' ? '高' : '通常'})に応じた迅速な成約`,
                  '取引不成立・長期在庫化リスクの解消',
                ],
              },
              explanationMessage: `¥${lastOpponentOffer.price.toLocaleString()}でのお取引を承諾いたしました。ご購入手続きをお願いいたします。`,
            };
          }
        }

        // カウンターオファー
        const lastOwnOffer = [...history].reverse().find((o) => o.senderRole.includes('seller'));
        const sellerConcession = urgency === 'high' ? 0.6 : urgency === 'medium' ? 0.4 : 0.25;
        const baseFrom = lastOwnOffer ? lastOwnOffer.price : listing.price;
        const newSellerPrice = Math.max(
          reservationPrice,
          Math.round((baseFrom - (baseFrom - lastOpponentOffer.price) * sellerConcession) / 100) * 100
        );

        return {
          action: 'counter_offer',
          price: newSellerPrice,
          reasoning: {
            summary: `出品期間と需要を反映し、¥${newSellerPrice.toLocaleString()}へ歩み寄り提示`,
            marketMedian: listing.marketMedianPrice,
            daysListed: listing.daysListed,
            demandTrend: listing.recentDemand,
              acceptanceScore,
            factors: [
              `出品期間${listing.daysListed}日の経過と閲覧数(${listing.viewsCount})を分析`,
              `最低許容 ¥${reservationPrice.toLocaleString()} を下回らない範囲で譲歩`,
              '成約スピードと利益の最適バランス',
            ],
          },
          explanationMessage: `コメントありがとうございます。恐れ入りますが¥${newSellerPrice.toLocaleString()}までであればお値下げ可能です。いかがでしょうか？`,
        };
      } else {
        // 売り手初回
        return {
          action: 'make_offer',
          price: listing.price,
          reasoning: {
            summary: `出品価格 ¥${listing.price.toLocaleString()} で待機`,
            marketMedian: listing.marketMedianPrice,
            daysListed: listing.daysListed,
            demandTrend: listing.recentDemand,
                acceptanceScore,
            factors: ['初回出品価格の維持', '買い手からの初期オファー待ち'],
          },
          explanationMessage: `出品価格は¥${listing.price.toLocaleString()}となります。`,
        };
      }
    }
  }
}
