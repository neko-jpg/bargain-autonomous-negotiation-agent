import { AgentActionType, NegotiationOffer } from '@/types/negotiation';

export interface GuardrailValidationResult {
  isValid: boolean;
  sanitizedAction: AgentActionType;
  sanitizedPrice: number;
  sanitizedWaitHours?: number;
  correctionReason?: string;
  rejectionReason?: string;
}

export class NegotiationGuardrails {
  /**
   * エージェントが立案したアクションと金額が、Private Stateおよび交渉ルールに準拠しているかを決定論的に検証・補正する
   */
  static validateAndSanitize(
    role: 'buyer' | 'seller',
    plannedAction: AgentActionType,
    plannedPrice: number,
    reservationPrice: number, // Buyer: maxPrice, Seller: minPrice
    targetPrice: number,
    history: NegotiationOffer[],
    currentListingPrice: number,
    plannedWaitHours?: number
  ): GuardrailValidationResult {
    let sanitizedAction = plannedAction;
    let sanitizedPrice = Number.isFinite(plannedPrice) ? Math.round(plannedPrice) : Math.round(targetPrice);
    let sanitizedWaitHours = plannedWaitHours;
    let correctionReason: string | undefined;

    const addCorrection = (reason: string) => {
      correctionReason = correctionReason ? `${correctionReason} ${reason}` : reason;
    };

    if (!Number.isFinite(plannedPrice)) {
      addCorrection('提示額が不正なため、目標価格を基準に補正しました。');
    }

    const lastOpponentOffer = [...history]
      .reverse()
      .find((o) => (role === 'buyer' ? o.senderRole.includes('seller') : o.senderRole.includes('buyer')));

    const lastOwnOffer = [...history]
      .reverse()
      .find((o) => (role === 'buyer' ? o.senderRole.includes('buyer') : o.senderRole.includes('seller')));

    if (role === 'buyer') {
      // 1. 買い手の上限価格（maxPrice）の超過防止
      if (sanitizedPrice > reservationPrice) {
        sanitizedPrice = reservationPrice;
        addCorrection(`上限価格(¥${reservationPrice.toLocaleString()})を超えたため上限額に補正しました。`);
      }

      // 2. 出品価格を超えた提示の防止
      if (sanitizedPrice > currentListingPrice) {
        sanitizedPrice = currentListingPrice;
        addCorrection('出品価格を超えないように補正しました。');
      }

      // 買い手自身の過去提示額より下がる逆行提示の防止
      if (lastOwnOffer && sanitizedPrice < lastOwnOffer.price && (sanitizedAction === 'make_offer' || sanitizedAction === 'counter_offer')) {
        sanitizedPrice = lastOwnOffer.price;
        addCorrection(`前回の自己提示額(¥${lastOwnOffer.price.toLocaleString()})より低くならないよう補正しました。`);
      }
    } else {
      // 売り手側のガードレール
      // 1. 売り手の最低価格（minPrice）の下回り防止
      if (sanitizedPrice < reservationPrice) {
        sanitizedPrice = reservationPrice;
        addCorrection(`最低許容価格(¥${reservationPrice.toLocaleString()})を下回ったため最低額に補正しました。`);
      }

      // 売り手自身の過去提示額より上がる逆行提示の防止
      if (lastOwnOffer && sanitizedPrice > lastOwnOffer.price && (sanitizedAction === 'make_offer' || sanitizedAction === 'counter_offer')) {
        sanitizedPrice = lastOwnOffer.price;
        addCorrection(`前回の自己提示額(¥${lastOwnOffer.price.toLocaleString()})より高くならないよう補正しました。`);
      }
    }

    // 5. 待機時間のバリデーション
    if (sanitizedAction === 'wait') {
      if (!Number.isFinite(sanitizedWaitHours) || (sanitizedWaitHours ?? 0) < 1) {
        sanitizedWaitHours = 6;
        addCorrection('待機時間を6時間に補正しました。');
      } else if ((sanitizedWaitHours ?? 0) > 72) {
        sanitizedWaitHours = 72;
        addCorrection('待機時間を72時間以内に補正しました。');
      }
    }

    return {
      isValid: !correctionReason,
      sanitizedAction,
      sanitizedPrice: Math.max(0, sanitizedPrice),
      sanitizedWaitHours,
      correctionReason,
    };
  }

  /**
   * 相手Agentに渡す情報のサニタイズ（Private Stateの完全隔離）
   */
  static filterPublicStateForOpponent(sessionHistory: NegotiationOffer[]) {
    // 思考ログや理由のPrivate State言及を相手に見せない
    return sessionHistory.map((offer) => ({
      id: offer.id,
      round: offer.round,
      timestamp: offer.timestamp,
      senderRole: offer.senderRole,
      senderName: offer.senderName,
      price: offer.price,
      terms: offer.terms,
      actionType: offer.actionType,
      messageText: offer.messageText,
      // reasoning は自身のUIでのみ表示し、相手Agentへの生プロンプトには渡さない
    }));
  }
}
