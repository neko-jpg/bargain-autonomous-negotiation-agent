import { NegotiationMemory, NegotiationOffer, NegotiationSession } from '@/types/negotiation';

const unique = (values: string[], limit = 6) => Array.from(new Set(values.filter(Boolean))).slice(-limit);

export function updateNegotiationMemory(
  session: NegotiationSession,
  latestOffer: NegotiationOffer
): NegotiationMemory {
  const current = session.agentMemory ?? {
    acceptedConditions: [],
    rejectedConditions: [],
    concessionRoom: '相手の反応を観測中です。',
    counterpartPattern: 'まだ十分な反応データがありません。',
    nextOptions: [],
    risks: [],
    updatedAt: new Date().toISOString(),
  };
  const terms = latestOffer.terms;
  const conditionSummary = terms
    ? `${latestOffer.price.toLocaleString()}円・数量${terms.quantity}・納期${terms.deliveryDays}日・${terms.taxIncluded ? '税込' : '税別'}`
    : `${latestOffer.price.toLocaleString()}円の価格条件`;
  const isHuman = latestOffer.senderRole.includes('human');
  const nextOptions = latestOffer.actionType === 'accept_offer'
    ? ['合意条件を契約ドラフトへ反映する', '人間承認後に取引確認へ進む']
    : latestOffer.actionType === 'wait'
      ? ['待機後に相場と相手の反応を再評価する', '条件を維持したまま再提案する']
      : ['価格と納期の組み合わせを比較する', '次の提案を承認キューで確認する'];

  return {
    acceptedConditions: unique(latestOffer.actionType === 'accept_offer'
      ? [...current.acceptedConditions, conditionSummary]
      : current.acceptedConditions),
    rejectedConditions: unique(latestOffer.actionType === 'reject_offer'
      ? [...current.rejectedConditions, conditionSummary]
      : current.rejectedConditions),
    concessionRoom: latestOffer.actionType === 'accept_offer'
      ? '合意済みです。追加の価格譲歩は不要です。'
      : latestOffer.actionType === 'wait'
        ? '価格を急いで動かさず、時間経過による条件改善を確認します。'
        : '価格だけでなく、送料・納期・支払条件の組み合わせで調整可能です。',
    counterpartPattern: isHuman
      ? '人間からの条件提示を受けています。明示された条件を優先します。'
      : latestOffer.senderRole.includes('seller')
        ? '売り手側は価格と公開条件を中心に応答しています。'
        : '買い手側は価格と上限条件を中心に応答しています。',
    nextOptions: unique(nextOptions, 4),
    risks: unique([
      ...(latestOffer.actionType === 'wait' ? ['待機中に他の買い手・売り手が先に成立する可能性'] : []),
      ...(latestOffer.decision?.guardrailCorrection ? ['ポリシー補正が発生したため、条件の再確認が必要'] : []),
      ...(latestOffer.decision?.requiresHumanApproval ? ['人間承認が完了するまで外部送信しない'] : []),
    ], 5),
    updatedAt: new Date().toISOString(),
  };
}

