'use client';

import { useId, useState } from 'react';
import { ChevronDown, Clock3, FileCheck2, ShieldAlert, Sparkles } from 'lucide-react';
import { NegotiationOffer, Listing } from '@/types/negotiation';
import { totalOfferCost } from '@/lib/negotiation/terms';
import { localizeApprovalReason, localizeGuardrailCorrection, localizeMessage, localizeReasoning, localizeSenderName, localizeTermValue } from '@/lib/i18n/content';
import { actionLabelKey } from '@/lib/i18n/labels';
import { useI18n } from '@/lib/i18n/provider';

interface NegotiationEventCardProps {
  offer: NegotiationOffer;
  listing: Listing;
  index?: number;
}

export function NegotiationEventCard({ offer, listing, index }: NegotiationEventCardProps) {
  const { t, formatYen } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const isBuyer = offer.senderRole.includes('buyer');
  const isWait = offer.actionType === 'wait';
  const terms = offer.terms;
  const total = terms ? totalOfferCost(offer.price, terms) : offer.price;
  const roleClass = isBuyer ? 'deal-summary-event--buyer' : 'deal-summary-event--seller';
  const message = localizeMessage(t, offer.messageTemplate, offer.messageText);
  const reasoning = localizeReasoning(t, offer.reasoning);
  const guardrailCorrection = localizeGuardrailCorrection(t, offer.decision);
  const approvalReason = localizeApprovalReason(t, offer.decision);

  return (
    <article className={`deal-summary-event ${roleClass} ${isOpen ? 'is-expanded' : ''}`} data-expanded={isOpen}>
      <button
        type="button"
        className="deal-summary-event__toggle"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="deal-summary-event__round">{t('detail.round', { round: offer.round })}{index !== undefined ? ` · ${String(index + 1).padStart(2, '0')}` : ''}</span>
        <span className="deal-summary-event__copy">
          <span className="deal-summary-event__sender">{localizeSenderName(t, offer)}</span>
          <span className="deal-summary-event__preview">{message}</span>
        </span>
        <span className="deal-summary-event__price">{isWait ? 'WAIT' : formatYen(offer.price)}</span>
        <ChevronDown className="deal-summary-event__chevron" aria-hidden="true" />
      </button>

      {isOpen && (
        <div id={contentId} className="deal-summary-event__details" role="region" aria-label={t('offer.detailsAria', { round: offer.round })}>
          <div className="deal-summary-event__message">
            <span className="eyebrow">MESSAGE / {offer.timestamp}</span>
            <p>{message}</p>
          </div>

          {terms && (
            <div className="deal-summary-event__detail-section">
              <p className="deal-summary-event__detail-label">{t('offer.terms')}</p>
              <div className="deal-summary-event__terms">
                <span>{t('offer.productPrice', { price: formatYen(offer.price) })}</span>
                <span>{t('offer.total', { price: formatYen(total) })}</span>
                <span>{t('offer.quantity', { count: terms.quantity })}</span>
                <span>{terms.currency}</span>
                <span>{terms.taxIncluded ? t('offer.taxIncluded') : t('offer.taxExcluded')}</span>
                <span>{t('offer.shipping', { price: formatYen(terms.shippingCost) })}</span>
                <span>{t('offer.delivery', { days: terms.deliveryDays })}</span>
                <span>{localizeTermValue(t, terms.paymentTerms, terms.paymentTerms)}</span>
                <span>{t('offer.warranty', { text: localizeTermValue(t, terms.warranty, terms.warranty) })}</span>
                {terms.expiresAt && <span>{t('offer.expires', { date: terms.expiresAt })}</span>}
              </div>
            </div>
          )}

          {reasoning && (
            <div className="deal-summary-event__detail-section deal-summary-event__reasoning">
              <p className="deal-summary-event__detail-label"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t('offer.reasoning')}</p>
              <p>{reasoning.summary}</p>
              <ul>{reasoning.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
            </div>
          )}

          <div className="deal-summary-event__meta-grid">
            <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{t('offer.actionMeta', { action: t(actionLabelKey(offer.actionType) ?? 'enum.action.make_offer') })}</span>
            {offer.waitTimeHours && <span>{t('offer.waitMeta', { hours: offer.waitTimeHours })}</span>}
            {offer.decision?.candidateCount !== undefined && <span>{t('offer.candidates', { count: offer.decision.candidateCount })}</span>}
            {offer.decision?.requiresHumanApproval && <span><FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />{t('offer.needsApproval')}</span>}
          </div>

          {guardrailCorrection && (
            <div className="deal-summary-event__notice"><ShieldAlert className="h-4 w-4" aria-hidden="true" /><span>{guardrailCorrection}</span></div>
          )}
          {approvalReason && <p className="deal-summary-event__approval-reason">{approvalReason}</p>}

          {offer.alternatives && offer.alternatives.length > 1 && (
            <div className="deal-summary-event__detail-section">
              <p className="deal-summary-event__detail-label">{t('offer.alternatives')}</p>
              <div className="deal-summary-event__alternatives">
                {offer.alternatives.map((alternative, alternativeIndex) => (
                  <span key={`${alternative.action}-${alternative.price}-${alternativeIndex}`} className={alternativeIndex === offer.decision?.selectedCandidate ? 'is-selected' : ''}>
                    {t(actionLabelKey(alternative.action) ?? 'enum.action.make_offer')} · {alternative.price ? formatYen(alternative.price) : t('common.none')}{alternative.isValid === false ? ` · ${t('offer.outOfPolicy')}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="deal-summary-event__listing-note">{t('offer.listingNote', { title: listing.title })}</p>
        </div>
      )}
    </article>
  );
}
