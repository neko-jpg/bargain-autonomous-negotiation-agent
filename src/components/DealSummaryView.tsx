'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { motion } from 'motion/react';
import { CheckCircle2, Download, ExternalLink, PackageCheck, ShieldCheck, Star, Truck } from 'lucide-react';
import { PublicCommitReceipt, PublicDealSummary, Listing, NegotiationOfferView } from '@/types/negotiation';
import { NegotiationEventCard } from '@/components/NegotiationEventCard';
import { ContractDraftPanel } from '@/components/ContractDraftPanel';
import { useI18n } from '@/lib/i18n/provider';

interface DealSummaryViewProps {
  summary?: PublicDealSummary;
  listing: Listing;
  offers?: NegotiationOfferView[];
  buyerMaxPrice?: number;
  sellerSurplus?: number;
  negotiationId: string;
  commitReceipt?: PublicCommitReceipt;
  onGoToDetail: () => void;
}

export function DealSummaryView({ summary, listing, offers = [], buyerMaxPrice, sellerSurplus, negotiationId, commitReceipt, onGoToDetail }: DealSummaryViewProps) {
  const { t, formatYen, formatDateTime } = useI18n();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const agreedPrice = summary?.agreedPrice ?? listing.price;
  // The total is the amount the commit gate recorded (price plus shipping), so
  // the summary shows exactly what the buyer approved. No fee is charged.
  const total = commitReceipt?.amount ?? agreedPrice;
  const shippingCost = total - agreedPrice;

  const submitFeedback = (event: FormEvent) => {
    event.preventDefault();
    if (!rating) return;
    setSubmitted(true);
  };

  const downloadReceipt = () => {
    const receipt = [
      t('deal.receiptFileTitle'),
      t('deal.receiptLineProduct', { title: listing.title }),
      t('deal.receiptLinePrice', { price: formatYen(agreedPrice) }),
      t('deal.receiptLineId', { id: listing.id }),
      t('deal.receiptLineDate', { date: formatDateTime(summary?.completedAt ?? new Date().toISOString()) }),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([receipt], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bargain-receipt-${listing.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const executorLabel = commitReceipt?.executor === 'webhook' ? t('deal.executorWebhook') : t('deal.executorSandbox');

  return (
    <div className="deal-summary-page page-container py-8 sm:py-10">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="deal-summary-hero"
        aria-labelledby="deal-summary-title"
      >
        <div className="deal-summary-hero__header">
          <div className="deal-summary-hero__mark"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /></div>
          <div>
            <p className="eyebrow">{t('deal.eyebrow')}</p>
            <h1 id="deal-summary-title">{t('deal.title')}</h1>
            <p>{t('deal.body')}</p>
          </div>
          <div className="deal-summary-hero__price-wrap">
            <span>{t('deal.agreedPrice')}</span>
            <strong>{formatYen(agreedPrice)}</strong>
          </div>
        </div>
        <div className="deal-summary-hero__metrics">
          <SummaryMetric tone="yellow" label={t('dashboard.buyerSavings')} value={formatYen(summary?.buyerSaved ?? 0)} hint={`${summary?.buyerSavedPercent ?? 0}% OFF`} />
          <SummaryMetric tone="mint" label={t('deal.sellerSurplus')} value={sellerSurplus === undefined ? t('common.private') : `+${formatYen(sellerSurplus)}`} hint={sellerSurplus === undefined ? t('common.privateHint') : t('deal.sellerSurplusHint')} />
          <SummaryMetric tone="surface" label={t('dashboard.actions')} value={t('dashboard.count', { count: summary?.totalActions ?? offers.length })} hint={t('deal.allEvents')} />
          <SummaryMetric tone="rose" label={t('deal.commitApproval')} value={commitReceipt ? (commitReceipt.authorizationMode === 'human' ? t('deal.signedByHuman') : t('deal.byPolicy')) : t('common.none')} hint={commitReceipt ? `Commit Gate · ${commitReceipt.intentHash.slice(0, 10)}…` : t('deal.beforeCommit')} />
        </div>
      </motion.section>

      <div className="deal-summary-layout">
        <div className="deal-summary-main">
          <section className="deal-summary-panel deal-summary-order" aria-labelledby="order-summary-title">
            <div className="deal-summary-panel__heading">
              <div>
                <p className="eyebrow">{t('deal.orderEyebrow')}</p>
                <h2 id="order-summary-title">{t('deal.orderTitle')}</h2>
              </div>
              <AriaButton aria-label={t('deal.receiptAria')} onPress={downloadReceipt} className="deal-summary-button deal-summary-button--secondary">
                <Download className="h-4 w-4" aria-hidden="true" />{t('deal.receipt')}
              </AriaButton>
            </div>

            <div className="deal-summary-product">
              <div className="deal-summary-product__image">
                <Image src={listing.imageUrl} alt="" fill sizes="80px" className="object-cover" />
              </div>
              <div className="min-w-0">
                <h3>{listing.title}</h3>
                <p>{t('deal.seller', { name: listing.sellerName })}</p>
              </div>
            </div>

            <div className="deal-summary-lines">
              <Line label={t('deal.itemPrice')} value={formatYen(agreedPrice)} />
              {buyerMaxPrice && <Line label={t('deal.yourMax')} value={formatYen(buyerMaxPrice)} />}
              <Line label={t('deal.shipping')} value={shippingCost > 0 ? formatYen(shippingCost) : t('deal.shippingIncluded')} />
              <Line label={t('deal.total')} value={formatYen(total)} strong />
            </div>
            <p className="deal-summary-note">{t('deal.commitNote', { executor: executorLabel })}</p>
          </section>

          <section className="deal-summary-panel deal-summary-history" aria-labelledby="audit-trail-title">
            <div className="deal-summary-panel__heading deal-summary-panel__heading--history">
              <div>
                <p className="eyebrow">{t('deal.auditEyebrow')}</p>
                <h2 id="audit-trail-title">{t('deal.auditTitle')}</h2>
              </div>
              <span className="deal-summary-count">{t('deal.eventCount', { count: offers.length })}</span>
            </div>

            <div className="deal-summary-events">
              {offers.length === 0 ? (
                <p className="deal-summary-empty">{t('deal.noHistory')}</p>
              ) : offers.map((offer, index) => <NegotiationEventCard key={offer.id} offer={offer} listing={listing} index={index} />)}
            </div>
          </section>
        </div>

        <aside className="deal-summary-side">
          <section className="deal-summary-panel deal-summary-steps" aria-labelledby="next-steps-title">
            <div className="deal-summary-panel__heading">
              <div>
                <p className="eyebrow">{t('deal.handoffEyebrow')}</p>
                <h2 id="next-steps-title">{t('deal.nextSteps')}</h2>
              </div>
              <span className="deal-summary-status">{t('deal.agreed')}</span>
            </div>
            <div className="deal-summary-steps__list">
              <Step icon={PackageCheck} title={t('deal.step1Title')} body={t('deal.step1Body')} done />
              <Step icon={Truck} title={t('deal.step2Title')} body={t('deal.step2Body')} />
              <Step icon={ShieldCheck} title={t('deal.step3Title')} body={t('deal.step3Body')} />
            </div>
            <div className="deal-summary-actions">
              <AriaButton onPress={onGoToDetail} className="deal-summary-button deal-summary-button--primary">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('deal.viewHistory')}
              </AriaButton>
              <AriaButton onPress={downloadReceipt} className="deal-summary-button deal-summary-button--secondary">
                <Download className="h-4 w-4" aria-hidden="true" />{t('deal.saveReceipt')}
              </AriaButton>
            </div>
          </section>

          <section className="deal-summary-panel deal-summary-rating" aria-labelledby="rating-title">
            <div className="deal-summary-panel__heading">
              <div>
                <p className="eyebrow">{t('deal.feedbackEyebrow')}</p>
                <h2 id="rating-title">{t('deal.ratingTitle')}</h2>
              </div>
              <Star className="h-5 w-5" aria-hidden="true" />
            </div>
            {submitted ? (
              <p className="deal-summary-rating__success" aria-live="polite">{t('deal.ratingThanks')}</p>
            ) : (
              <form onSubmit={submitFeedback} className="deal-summary-rating__form">
                <div className="deal-summary-rating__stars" aria-label={t('deal.ratingAria')}>
                  <span className="sr-only">{t('deal.ratingHint')}</span>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <AriaButton key={value} type="button" aria-label={t('deal.starAria', { count: value })} onPress={() => setRating(value)} className={`deal-summary-rating__star ${value <= rating ? 'is-selected' : ''}`}>
                      <Star className="h-5 w-5" aria-hidden="true" />
                    </AriaButton>
                  ))}
                </div>
                <label className="deal-summary-rating__field">
                  <span className="sr-only">{t('deal.feedbackLabel')}</span>
                  <textarea id="deal-feedback" name="feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={500} placeholder={t('deal.feedbackPlaceholder')} />
                </label>
                <AriaButton type="submit" isDisabled={!rating} className="deal-summary-button deal-summary-button--primary w-full">{t('deal.submitRating')}</AriaButton>
              </form>
            )}
          </section>

          <ContractDraftPanel negotiationId={negotiationId} />
        </aside>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'yellow' | 'mint' | 'surface' | 'rose' }) {
  return (
    <div className={`deal-summary-metric deal-summary-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`deal-summary-line ${strong ? 'is-total' : ''}`}><span>{label}</span><span>{value}</span></div>;
}

function Step({ icon: Icon, title, body, done = false }: { icon: typeof PackageCheck; title: string; body: string; done?: boolean }) {
  return (
    <div className={`deal-summary-step ${done ? 'deal-summary-step--done' : ''}`}>
      <div className="deal-summary-step__icon"><Icon className="h-5 w-5" aria-hidden="true" /></div>
      <div>
        <p>{title}</p>
        <span>{body}</span>
      </div>
      {done && <CheckCircle2 className="deal-summary-step__check h-5 w-5" aria-hidden="true" />}
    </div>
  );
}
