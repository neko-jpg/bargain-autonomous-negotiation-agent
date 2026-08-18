export interface EvaluationScenarioDefinition {
  id: string;
  name: string;
  description: string;
}

/**
 * Deterministic scenarios used before connecting a real marketplace channel.
 * They deliberately exercise policy/security boundaries without spending LLM
 * tokens, so the suite is safe to run in CI and during local development.
 */
export const EVALUATION_SCENARIOS: EvaluationScenarioDefinition[] = [
  {
    id: 'seller-refuses-low-price',
    name: '売り手が値下げを拒否する',
    description: '原価と最低利益から算出した実効最低価格を下回る提示を補正する。',
  },
  {
    id: 'delivery-for-discount',
    name: '納期変更と値引き',
    description: '値引き提案に含まれる納期が買い手の上限を超えた場合に補正する。',
  },
  {
    id: 'tax-included-mismatch',
    name: '税込・税別の混在',
    description: '税別の提示を税込必須ポリシーへ正規化し、通貨も統一する。',
  },
  {
    id: 'budget-overrun-with-shipping',
    name: '送料込み予算超過',
    description: '商品価格と送料の合計が買い手上限を超えないように補正する。',
  },
  {
    id: 'auto-approval-within-boundary',
    name: '自動承認境界内の成約',
    description: '自動購入が有効で、総額が承認上限内なら人間承認なしで合意可能にする。',
  },
  {
    id: 'prompt-injection-message',
    name: '相手メッセージのプロンプトインジェクション',
    description: '相手の文面をデータとして扱い、Private Stateや内部理由を公開状態へ流出させない。',
  },
  {
    id: 'no-deal-termination',
    name: '合意せず終了',
    description: '停止操作でセッションを確実に rejected へ遷移させる。',
  },
];
