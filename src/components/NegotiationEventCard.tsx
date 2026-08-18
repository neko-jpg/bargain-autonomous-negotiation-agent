'use client';

import { useId, useState } from 'react';
import { ChevronDown, Clock3, FileCheck2, ShieldAlert, Sparkles } from 'lucide-react';
import { NegotiationOffer, Listing } from '@/types/negotiation';
import { totalOfferCost } from '@/lib/negotiation/terms';

interface NegotiationEventCardProps {
  offer: NegotiationOffer;
  listing: Listing;
  index?: number;
}

const yen = (value: number) => `¥${Math.round(value).toLocaleString('ja-JP')}`;

export function NegotiationEventCard({ offer, listing, index }: NegotiationEventCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const isBuyer = offer.senderRole.includes('buyer');
  const isWait = offer.actionType === 'wait';
  const terms = offer.terms;
  const total = terms ? totalOfferCost(offer.price, terms) : offer.price;
  const roleClass = isBuyer ? 'deal-summary-event--buyer' : 'deal-summary-event--seller';

  return (
    <article className={`deal-summary-event ${roleClass} ${isOpen ? 'is-expanded' : ''}`} data-expanded={isOpen}>
      <button
        type="button"
        className="deal-summary-event__toggle"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="deal-summary-event__round">Round {offer.round}{index !== undefined ? ` · ${String(index + 1).padStart(2, '0')}` : ''}</span>
        <span className="deal-summary-event__copy">
          <span className="deal-summary-event__sender">{offer.senderName}</span>
          <span className="deal-summary-event__preview">{offer.messageText}</span>
        </span>
        <span className="deal-summary-event__price">{isWait ? 'WAIT' : yen(offer.price)}</span>
        <ChevronDown className="deal-summary-event__chevron" aria-hidden="true" />
      </button>

      {isOpen && (
        <div id={contentId} className="deal-summary-event__details" role="region" aria-label={`Round ${offer.round}の詳細`}>
          <div className="deal-summary-event__message">
            <span className="eyebrow">MESSAGE / {offer.timestamp}</span>
            <p>{offer.messageText}</p>
          </div>

          {terms && (
            <div className="deal-summary-event__detail-section">
              <p className="deal-summary-event__detail-label">提示条件</p>
              <div className="deal-summary-event__terms">
                <span>商品価格 {yen(offer.price)}</span>
                <span>総額 {yen(total)}</span>
                <span>数量 {terms.quantity}</span>
                <span>{terms.currency}</span>
                <span>{terms.taxIncluded ? '税込' : '税別'}</span>
                <span>送料 {yen(terms.shippingCost)}</span>
                <span>納期 {terms.deliveryDays}日</span>
                <span>{terms.paymentTerms}</span>
                <span>保証 {terms.warranty}</span>
                {terms.expiresAt && <span>期限 {terms.expiresAt}</span>}
              </div>
            </div>
          )}

          {offer.reasoning && (
            <div className="deal-summary-event__detail-section deal-summary-event__reasoning">
              <p className="deal-summary-event__detail-label"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />AI判断理由</p>
              <p>{offer.reasoning.summary}</p>
              <ul>{offer.reasoning.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
            </div>
          )}

          <div className="deal-summary-event__meta-grid">
            <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />アクション: {offer.actionType}</span>
            {offer.waitTimeHours && <span>待機: {offer.waitTimeHours}時間</span>}
            {offer.decision?.candidateCount !== undefined && <span>比較候補: {offer.decision.candidateCount}件</span>}
            {offer.decision?.requiresHumanApproval && <span><FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />人間承認が必要</span>}
          </div>

          {offer.decision?.guardrailCorrection && (
            <div className="deal-summary-event__notice"><ShieldAlert className="h-4 w-4" aria-hidden="true" /><span>{offer.decision.guardrailCorrection}</span></div>
          )}
          {offer.decision?.approvalReason && <p className="deal-summary-event__approval-reason">{offer.decision.approvalReason}</p>}

          {offer.alternatives && offer.alternatives.length > 1 && (
            <div className="deal-summary-event__detail-section">
              <p className="deal-summary-event__detail-label">比較した代替案</p>
              <div className="deal-summary-event__alternatives">
                {offer.alternatives.map((alternative, alternativeIndex) => (
                  <span key={`${alternative.action}-${alternative.price}-${alternativeIndex}`} className={alternativeIndex === offer.decision?.selectedCandidate ? 'is-selected' : ''}>
                    {alternative.action} · {alternative.price ? yen(alternative.price) : '—'}{alternative.isValid === false ? ' · 制約外' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="deal-summary-event__listing-note">対象商品: {listing.title}</p>
        </div>
      )}
    </article>
  );
}
