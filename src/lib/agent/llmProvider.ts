import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { AgentAlternative, Listing, AgentActionType, ActionReasoning, NegotiationOffer, NegotiationTerms } from '@/types/negotiation';
import { normalizeNegotiationTerms } from '@/lib/negotiation/terms';

export interface AgentPlanningResult {
  action: AgentActionType;
  price: number;
  waitHours?: number;
  reasoning: ActionReasoning;
  explanationMessage: string;
  terms?: NegotiationTerms;
  alternatives: AgentAlternative[];
  telemetry: {
    provider: 'google' | 'openai' | 'heuristic';
    model?: string;
    fallback: boolean;
  };
}

type LLMProviderName = 'google' | 'openai' | 'auto';

const isUsableApiKey = (value: string | undefined): value is string => {
  if (!value) return false;
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  return normalized.length > 0 && !/^(your_|placeholder|replace_me|change_me)/i.test(normalized);
};

const AgentPlanSchema = z.object({
  action: z.enum(['make_offer', 'counter_offer', 'accept_offer', 'reject_offer', 'wait', 'ask_user']),
  price: z.number().finite().int().nonnegative(),
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
    return configured === 'google' || configured === 'openai' ? configured : 'auto';
  }

  private static getModel(): { model: BaseChatModel; provider: 'google' | 'openai'; modelName: string } | null {
    const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const provider = this.getProviderPreference();
    const candidates: Array<'google' | 'openai'> = provider === 'google'
      ? ['google']
      : provider === 'openai'
        ? ['openai']
        : ['google', 'openai'];

    for (const candidate of candidates) {
      if (candidate === 'google' && isUsableApiKey(googleApiKey)) {
        try {
          const modelName = process.env.BARGAIN_GOOGLE_MODEL || 'gemini-3.6-flash';
          return { model: new ChatGoogleGenerativeAI({
            apiKey: googleApiKey,
            // Older Gemini Flash models are no longer available to this API key.
            // Keep the model configurable, but use a current stable model by default.
            modelName,
            temperature: 0.2,
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
            maxRetries: 1,
          }), provider: 'openai', modelName };
        } catch (e) {
          console.warn('OpenAI client initialization failed, fallback to heuristic engine:', e);
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
    winProb: number,
    batna: number,
    baseTerms?: Partial<NegotiationTerms>
  ): Promise<AgentPlanningResult> {
    const configuredModel = this.getModel();
    const model = configuredModel?.model;

    // LLMが利用可能な場合はLLMに構造化プロンプトで推論を依頼
    if (model) {
      try {
        const lastOpponentOffer = [...history]
          .reverse()
          .find((o) => (role === 'buyer' ? o.senderRole.includes('seller') : o.senderRole.includes('buyer')));

        const systemPrompt = `あなたはC2Cマーケットプレイスにおける自律型価格交渉AIエージェント「Project BARGAIN」です。
役割: ${role === 'buyer' ? '買い手代理 (Buyer Agent)' : '売り手代理 (Seller Agent)'}
商品: ${listing.title} (出品価格: ¥${listing.price.toLocaleString()}, 相場中央値: ¥${listing.marketMedianPrice.toLocaleString()})
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

        const userPrompt = `現在の交渉履歴: ${JSON.stringify(
          history.map((h) => ({ role: h.senderRole, price: h.price, terms: h.terms, action: h.actionType }))
        )}
直近の相手提示: ${lastOpponentOffer ? `¥${lastOpponentOffer.price.toLocaleString()}` : 'まだなし'}
成約予測確率: ${winProb}%

最適なアクションと金額を決定してください。`;

        const structuredModel = typeof (model as any).withStructuredOutput === 'function'
          ? (model as any).withStructuredOutput(AgentPlanSchema, { name: 'negotiation_plan' })
          : model;

        const response = await structuredModel.invoke([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ]);

        const rawResponse = response && typeof response === 'object' && !('content' in response)
          ? response
          : (() => {
              const text = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);
              const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
              return JSON.parse(unfenced);
            })();
        const parsedResult = AgentPlanSchema.safeParse(rawResponse);
        if (parsedResult.success) {
          const parsed = parsedResult.data;
          return {
            action: parsed.action,
            price: parsed.price,
            waitHours: parsed.waitHours,
            reasoning: {
              summary: parsed.summaryReason,
              marketMedian: listing.marketMedianPrice,
              daysListed: listing.daysListed,
              demandTrend: listing.recentDemand,
              winProbability: winProb,
              factors: parsed.factors,
            },
            explanationMessage: parsed.explanationMessage,
            terms: normalizeNegotiationTerms(listing, parsed.terms ?? baseTerms),
            alternatives: [
              {
                action: parsed.action,
                price: parsed.price,
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
      winProb,
      batna
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
    winProb: number,
    batna: number
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
                winProbability: 95,
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
              winProbability: winProb,
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
            winProbability: winProb,
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
            winProbability: winProb,
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
                winProbability: 95,
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
        const currentSellerFloor = Math.max(reservationPrice, targetPrice);
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
            winProbability: winProb,
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
            winProbability: winProb,
            factors: ['初回出品価格の維持', '買い手からの初期オファー待ち'],
          },
          explanationMessage: `出品価格は¥${listing.price.toLocaleString()}となります。`,
        };
      }
    }
  }
}
