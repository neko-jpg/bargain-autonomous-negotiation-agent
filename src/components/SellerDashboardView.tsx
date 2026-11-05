'use client';

import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { ArrowRight, CheckCircle2, Clock3, Eye, Heart, MessageSquare, ShieldCheck, Shuffle, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Listing, PublicNegotiationSession } from '@/types/negotiation';
import { localizeMessage } from '@/lib/i18n/content';
import { conditionLabelKey } from '@/lib/i18n/labels';
import { useI18n } from '@/lib/i18n/provider';

interface SellerDashboardViewProps {
  listing: Listing;
  session?: PublicNegotiationSession;
  onOpenNegotiation?: () => void;
  onRerollListing?: () => void;
  onOpenListing?: () => void;
}

export function SellerDashboardView({ listing, session, onOpenNegotiation, onRerollListing, onOpenListing }: SellerDashboardViewProps) {
  const { t, formatYen, formatNumber } = useI18n();
  const latestOffer = session?.offers.at(-1);
  const currentPrice = session?.currentOfferPrice ?? listing.price;
  const marketGap = listing.price - listing.marketMedianPrice;
  const marketGapRate = listing.marketMedianPrice > 0 ? Math.round((Math.abs(marketGap) / listing.marketMedianPrice) * 100) : 0;
  const lowestPrice = Math.min(listing.marketMedianPrice, listing.price, currentPrice);
  const highestPrice = Math.max(listing.marketMedianPrice, listing.price, currentPrice);
  const priceRange = Math.max(1, highestPrice - lowestPrice);
  const marketPosition = clampPercent(((listing.marketMedianPrice - lowestPrice) / priceRange) * 100);
  const listingPosition = clampPercent(((listing.price - lowestPrice) / priceRange) * 100);
  const currentPosition = clampPercent(((currentPrice - lowestPrice) / priceRange) * 100);
  const negotiationState = session?.status === 'deal' ? t('seller.stateDeal') : session ? t('seller.stateActive') : t('seller.stateIdle');
  const conditionLabel = t(conditionLabelKey(listing.condition) ?? 'enum.condition.good');

  return (
    <div className="seller-console page-container py-8 sm:py-10">
      <header className="seller-console__header">
        <div className="seller-console__heading">
          <p className="eyebrow">{t('seller.eyebrow')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">{t('seller.title')}</h1>
            <span className="seller-status-badge"><span className="seller-status-badge__dot" />{t('seller.liveBadge')}</span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{t('seller.lead')}</p>
        </div>
        <div className="seller-console__actions">
          {onRerollListing && <AriaButton onPress={onRerollListing} className="secondary-button seller-console__switch"><Shuffle className="h-4 w-4" aria-hidden="true" />{t('seller.reroll')}</AriaButton>}
          {onOpenNegotiation && <AriaButton onPress={onOpenNegotiation} className="primary-button seller-console__action"><MessageSquare className="h-4 w-4" aria-hidden="true" />{t('seller.openNegotiation')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
        </div>
      </header>

      <section className="seller-listing-card mt-7" aria-labelledby="seller-listing-title">
        <div className="seller-listing-card__image relative">
          <Image src={listing.imageUrl} alt={listing.title} fill sizes="(max-width: 767px) 100vw, 190px" className="object-cover" priority />
          <span className="seller-listing-card__image-tag">{listing.category}</span>
        </div>

        <div className="seller-listing-card__info">
          <div className="seller-listing-card__kicker"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t('seller.listingTag', { condition: conditionLabel })}</div>
          <h2 id="seller-listing-title" className="seller-listing-card__title">{listing.title}</h2>
          {onOpenListing && <AriaButton onPress={onOpenListing} className="seller-text-action seller-listing-card__open">{t('seller.viewListing')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
          <div className="seller-listing-card__price-line"><span>{t('seller.publicPrice')}</span><strong>{formatYen(listing.price)}</strong></div>
          <div className="seller-listing-card__meta">
            <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{t('seller.listedDays', { count: listing.daysListed })}</span>
            <span><Eye className="h-3.5 w-3.5" aria-hidden="true" />{t('seller.views', { count: listing.viewsCount })}</span>
            <span><Heart className="h-3.5 w-3.5" aria-hidden="true" />{t('seller.likes', { count: listing.likesCount })}</span>
          </div>
        </div>

        <aside className="seller-market-summary" aria-label={t('seller.marketAria')}>
          <p className="eyebrow">{t('seller.marketPosition')}</p>
          <div className="seller-market-summary__headline">
            <span>{marketGap > 0 ? t('seller.aboveMarket') : marketGap < 0 ? t('seller.belowMarket') : t('seller.atMarket')}</span>
            <strong>{marketGapRate}%</strong>
          </div>
          <p className="seller-market-summary__note">{t('seller.medianNote', { price: formatYen(listing.marketMedianPrice) })}</p>
          <PriceRail marketPosition={marketPosition} listingPosition={listingPosition} currentPosition={currentPosition} />
          <div className="seller-market-summary__legend"><span><i className="seller-marker seller-marker--market" />{t('seller.legendMarket')}</span><span><i className="seller-marker seller-marker--listing" />{t('seller.legendListing')}</span></div>
        </aside>
      </section>

      <section className="seller-kpi-rail mt-5" aria-label={t('seller.kpiAria')}>
        <Kpi icon={Eye} label={t('seller.kpiViews')} value={formatNumber(listing.viewsCount)} hint={t('seller.kpiViewsHint')} tone="teal" />
        <Kpi icon={Heart} label={t('seller.kpiLikes')} value={formatNumber(listing.likesCount)} hint={t('seller.kpiLikesHint')} tone="coral" />
        <Kpi icon={TrendingUp} label={t('seller.kpiMedian')} value={formatYen(listing.marketMedianPrice)} hint={marketGap > 0 ? t('seller.kpiMedianAbove') : t('seller.kpiMedianWithin')} tone="mustard" />
        <Kpi icon={ShieldCheck} label={t('seller.kpiCompeting')} value={formatNumber(listing.competingListingsCount)} hint={t('seller.kpiCompetingHint', { count: listing.daysListed })} tone="plum" />
      </section>

      <div className="seller-workspace mt-5">
        <section className="seller-negotiation-panel" aria-labelledby="seller-negotiation-title">
          <header className="seller-panel-heading">
            <div><p className="eyebrow">NEGOTIATION / LIVE</p><h2 id="seller-negotiation-title">{t('seller.currentNegotiation')}</h2></div>
            <span className={`seller-live-state seller-live-state--${session?.status === 'deal' ? 'success' : session ? 'active' : 'idle'}`}><span />{negotiationState}</span>
          </header>

          {session ? (
            <div className="seller-negotiation-content">
              <div className="seller-offer-focus">
                <p className="seller-offer-focus__label">{t('seller.currentOffer')}</p>
                <strong>{formatYen(currentPrice)}</strong>
                <p className="seller-offer-focus__delta"><TrendingDown className="h-4 w-4" aria-hidden="true" />{t('seller.deltaFromList', { price: formatYen(Math.max(0, listing.price - currentPrice)) })}</p>
                {latestOffer ? <p className="seller-offer-focus__message">「{localizeMessage(t, latestOffer.messageTemplate, latestOffer.messageText)}」</p> : <p className="seller-offer-focus__message">{t('seller.waitingProposal')}</p>}
                {onOpenNegotiation && <AriaButton onPress={onOpenNegotiation} className="seller-text-action">{t('seller.viewNegotiation')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
              </div>
              <div className="seller-activity-rail">
                <div className="seller-activity-rail__top"><span>{t('seller.activity')}</span><strong>{t('seller.activityCount', { count: session.offers.length })}</strong></div>
                <div className="seller-activity-rail__line" aria-hidden="true"><span className="seller-activity-rail__fill" style={{ width: `${Math.min(100, Math.max(12, session.offers.length * 18))}%` }} /></div>
                <div className="seller-activity-rail__steps"><span className="is-done"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('seller.stepReview')}</span><span className={session.offers.length > 0 ? 'is-done' : ''}><span className="seller-step-dot" />{t('seller.stepObserve')}</span><span className={session.status === 'deal' ? 'is-done' : ''}><span className="seller-step-dot" />{t('seller.stepAgree')}</span></div>
              </div>
            </div>
          ) : (
            <div className="seller-negotiation-empty">
              <div className="seller-negotiation-empty__signal"><span /><span /><span /></div>
              <div><strong>{t('seller.emptyTitle')}</strong><p>{t('seller.emptyBody')}</p></div>
              {onOpenNegotiation && <AriaButton onPress={onOpenNegotiation} className="seller-text-action">{t('seller.openScreen')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
            </div>
          )}
        </section>

        <aside className="seller-principles-panel" aria-labelledby="seller-principles-title">
          <div className="seller-panel-heading seller-panel-heading--compact"><div><p className="eyebrow">{t('seller.guardrails')}</p><h2 id="seller-principles-title">{t('seller.principlesTitle')}</h2></div><ShieldCheck className="h-5 w-5 text-teal-800" aria-hidden="true" /></div>
          <p className="seller-principles-panel__lead">{t('seller.principlesLead')}</p>
          <ul className="seller-principles-list">
            <li><CheckCircle2 aria-hidden="true" />{t('seller.principle1')}</li>
            <li><CheckCircle2 aria-hidden="true" />{t('seller.principle2')}</li>
            <li><CheckCircle2 aria-hidden="true" />{t('seller.principle3')}</li>
            <li><CheckCircle2 aria-hidden="true" />{t('seller.principle4')}</li>
          </ul>
          <div className="seller-principles-panel__footer"><span className="seller-policy-chip"><span />{t('seller.chipPrivate')}</span><span>{t('seller.chipAudit')}</span></div>
        </aside>
      </div>
    </div>
  );
}

function PriceRail({ marketPosition, listingPosition, currentPosition }: { marketPosition: number; listingPosition: number; currentPosition: number }) {
  const { t } = useI18n();
  return (
    <div className="seller-price-rail" aria-label={t('seller.railAria')}>
      <span className="seller-price-rail__track" />
      <span className="seller-price-rail__marker seller-price-rail__marker--market" style={{ left: `${marketPosition}%` }} />
      <span className="seller-price-rail__marker seller-price-rail__marker--listing" style={{ left: `${listingPosition}%` }} />
      <span className="seller-price-rail__marker seller-price-rail__marker--current" style={{ left: `${currentPosition}%` }} />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Eye; label: string; value: string; hint: string; tone: 'teal' | 'coral' | 'mustard' | 'plum' }) {
  return <div className={`seller-kpi seller-kpi--${tone}`}><div className="seller-kpi__top"><span>{label}</span><Icon className="h-4 w-4" aria-hidden="true" /></div><strong>{value}</strong><small>{hint}</small></div>;
}

function clampPercent(value: number) {
  return Math.min(96, Math.max(4, Math.round(value)));
}
