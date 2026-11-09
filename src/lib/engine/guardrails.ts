import { AgentActionType, LocalizedMessage, NegotiationOffer } from '@/types/negotiation';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/dictionary';

export interface GuardrailValidationResult {
  isValid: boolean;
  sanitizedAction: AgentActionType;
  sanitizedPrice: number;
  sanitizedWaitHours?: number;
  correctionReason?: string;
  /** Structured form of `correctionReason`, so the UI can re-render it. */
  correctionReasons?: LocalizedMessage[];
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
    let correctionReasons: LocalizedMessage[] | undefined;

    const addCorrection = (template: LocalizedMessage) => {
      // The rendered text is kept for API clients and stored records; the
      // template lets the same correction render in the viewer's language.
      const reason = translate(DEFAULT_LOCALE, template.key, template.params);
      correctionReason = correctionReason ? `${correctionReason} ${reason}` : reason;
      correctionReasons = [...(correctionReasons ?? []), template];
    };

    if (!Number.isFinite(plannedPrice)) {
      addCorrection({ key: 'reason.guardrail.invalidOffer' });
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
        addCorrection({ key: 'reason.guardrail.aboveMax', params: { price: reservationPrice } });
      }

      // 2. 出品価格を超えた提示の防止
      if (sanitizedPrice > currentListingPrice) {
        sanitizedPrice = currentListingPrice;
        addCorrection({ key: 'reason.guardrail.aboveListing' });
      }

      // 買い手自身の過去提示額より下がる逆行提示の防止
      if (lastOwnOffer && sanitizedPrice < lastOwnOffer.price && (sanitizedAction === 'make_offer' || sanitizedAction === 'counter_offer')) {
        sanitizedPrice = lastOwnOffer.price;
        addCorrection({ key: 'reason.guardrail.belowOwnOffer', params: { price: lastOwnOffer.price } });
      }
    } else {
      // 売り手側のガードレール
      // 1. 売り手の最低価格（minPrice）の下回り防止
      if (sanitizedPrice < reservationPrice) {
        sanitizedPrice = reservationPrice;
        addCorrection({ key: 'reason.guardrail.belowMin', params: { price: reservationPrice } });
      }

      // 売り手自身の過去提示額より上がる逆行提示の防止
      if (lastOwnOffer && sanitizedPrice > lastOwnOffer.price && (sanitizedAction === 'make_offer' || sanitizedAction === 'counter_offer')) {
        sanitizedPrice = lastOwnOffer.price;
        addCorrection({ key: 'reason.guardrail.aboveOwnOffer', params: { price: lastOwnOffer.price } });
      }
    }

    // 5. 待機時間のバリデーション
    if (sanitizedAction === 'wait') {
      if (!Number.isFinite(sanitizedWaitHours) || (sanitizedWaitHours ?? 0) < 1) {
        sanitizedWaitHours = 6;
        addCorrection({ key: 'reason.guardrail.waitMin' });
      } else if ((sanitizedWaitHours ?? 0) > 72) {
        sanitizedWaitHours = 72;
        addCorrection({ key: 'reason.guardrail.waitMax' });
      }
    }

    return {
      isValid: !correctionReason,
      sanitizedAction,
      sanitizedPrice: Math.max(0, sanitizedPrice),
      sanitizedWaitHours,
      correctionReason,
      correctionReasons,
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
