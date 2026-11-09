'use client';

import { useMemo, useState, useTransition } from 'react';
import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { ArrowUpRight, Bot, ChevronDown, Clock3, Eye, Heart, PackageOpen, Search, Sparkles, Tag, TrendingDown } from 'lucide-react';
import { CATALOG_LISTING_COUNT, DEMO_CATALOG_ID, getCatalogCategories, type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';
import { Listing } from '@/types/negotiation';
import { categoryLabelKey, conditionLabelKey } from '@/lib/i18n/labels';
import { useI18n } from '@/lib/i18n/provider';

interface MarketplaceViewProps {
  listings: Listing[];
  activeCategory: CatalogCategoryId;
  onCategoryChange: (categoryId: CatalogCategoryId) => void;
  onSelectListing: (listing: Listing) => void;
  onRunDemo: () => void;
  onRunApiNegotiation: () => void;
  isDemoRunning?: boolean;
  isApiNegotiationStarting?: boolean;
  isFiltering?: boolean;
}

const accentClasses = ['market-accent-coral', 'market-accent-teal', 'market-accent-mustard', 'market-accent-plum', 'market-accent-jade'];

export function MarketplaceView({
  listings,
  activeCategory,
  onCategoryChange,
  onSelectListing,
  onRunDemo,
  onRunApiNegotiation,
  isDemoRunning = false,
  isApiNegotiationStarting = false,
  isFiltering = false,
}: MarketplaceViewProps) {
  const { t, formatYen, formatNumber } = useI18n();
  const [sortOrder, setSortOrder] = useState<'recommended' | 'price-asc' | 'price-desc' | 'likes'>('recommended');
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [isPending, startTransition] = useTransition();
  const categories = useMemo(() => getCatalogCategories(), []);

  const visibleListings = useMemo(() => {
    const sorted = [...listings];
    if (sortOrder === 'price-asc') sorted.sort((a, b) => a.price - b.price);
    if (sortOrder === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    if (sortOrder === 'likes') sorted.sort((a, b) => b.likesCount - a.likesCount);
    return sorted;
  }, [listings, sortOrder]);

  const toggleSaved = (listingId: string) => {
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(listingId)) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
  };

  const selectCategory = (categoryId: CatalogCategoryId) => {
    startTransition(() => onCategoryChange(categoryId));
  };

  const activeCategoryLabel = activeCategory === 'all'
    ? t('category.all')
    : t(categoryLabelKey(activeCategory) ?? 'category.all');

  return (
    <div className="page-container py-6 sm:py-9">
      <section className="market-hero shape-editorial" aria-labelledby="market-title">
        <div className="market-hero__copy">
          <div className="eyebrow market-hero__eyebrow"><Sparkles className="h-4 w-4" aria-hidden="true" /> {t('market.eyebrow', { count: CATALOG_LISTING_COUNT })}</div>
          <h1 id="market-title" className="text-page-title mt-3 max-w-2xl text-slate-950 sm:text-4xl">{t('market.titleLead')}<br /><span className="text-coral-strong">{t('market.titleEmphasis')}</span>{t('market.titleTail')}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">{t('market.lead')}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <AriaButton onPress={onRunDemo} isDisabled={isDemoRunning} isPending={isDemoRunning} className="primary-button shape-ticket">
              <Bot className="h-4 w-4" aria-hidden="true" />
              {isDemoRunning ? t('market.demoRunning') : t('market.demo')}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </AriaButton>
            <AriaButton onPress={onRunApiNegotiation} isDisabled={isApiNegotiationStarting} isPending={isApiNegotiationStarting} className="secondary-button shape-ticket">
              <Bot className="h-4 w-4" aria-hidden="true" />
              {isApiNegotiationStarting ? t('market.apiRunning') : t('market.api')}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </AriaButton>
            <span className="market-hero__note"><PackageOpen className="h-4 w-4" aria-hidden="true" /> {t('market.synced', { count: CATALOG_LISTING_COUNT })}</span>
          </div>
        </div>
        <div className="market-hero__stamp" aria-hidden="true"><span>{t('market.stampTitle')}</span><strong>{t('market.stampValue')}</strong><small>Private State</small></div>
      </section>

      <section className="mt-7" aria-labelledby="catalog-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">{t('market.browseEyebrow')}</p>
            <h2 id="catalog-heading" className="mt-1 text-section-title text-slate-950">{t('market.catalogHeading')} <span className="ml-1 text-sm font-normal text-slate-500">{t('market.itemCount', { count: visibleListings.length })}</span></h2>
          </div>
          <label className="market-sort">
            <span className="sr-only">{t('market.sortLabel')}</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
              <option value="recommended">{t('market.sort.recommended')}</option>
              <option value="price-asc">{t('market.sort.priceAsc')}</option>
              <option value="price-desc">{t('market.sort.priceDesc')}</option>
              <option value="likes">{t('market.sort.likes')}</option>
            </select>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </label>
        </div>

        <div className="category-strip" role="tablist" aria-label={t('market.categoryTabsAria')}>
          {categories.map((category) => {
            const isActive = category.id === activeCategory;
            return (
              <AriaButton
                key={category.id}
                aria-pressed={isActive}
                onPress={() => selectCategory(category.id)}
                className={`category-tab category-tab--${category.accent}`}
                data-selected={isActive ? 'true' : undefined}
              >
                <span>{t(categoryLabelKey(category.id) ?? 'category.all')}</span><small>{category.count}</small>
              </AriaButton>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3" aria-live="polite">
          <p className="text-sm text-slate-500">{t('market.browsingFrom', { category: activeCategoryLabel })}</p>
          {(isPending || isFiltering) && <span className="inline-flex items-center gap-2 text-xs font-bold text-teal-800"><span className="loading-dot" />{t('market.filtering')}</span>}
        </div>

        {visibleListings.length > 0 ? (
          <div className="market-grid mt-3" aria-busy={isPending || isFiltering}>
            {visibleListings.map((listing, index) => {
              const isDemo = listing.id === DEMO_CATALOG_ID;
              const isSaved = savedIds.has(listing.id);
              const accent = accentClasses[index % accentClasses.length];
              const priceGap = listing.price - listing.marketMedianPrice;
              return (
                <article key={listing.id} className={`market-card shape-balanced ${accent} ${isDemo ? 'market-card--featured' : ''}`}>
                  <div className="market-card__media-wrap">
                    <AriaButton onPress={() => onSelectListing(listing)} aria-label={t('market.detailAria', { title: listing.title })} className="market-card__media">
                      <Image src={listing.imageUrl} alt={listing.title} fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw" loading={index < 4 ? 'eager' : 'lazy'} className="object-cover" />
                    </AriaButton>
                    <div className="market-card__media-label"><span>{t(conditionLabelKey(listing.condition) ?? 'enum.condition.good')}</span>{listing.subcategory && <span>{listing.subcategory}</span>}</div>
                    <AriaButton onPress={() => toggleSaved(listing.id)} aria-label={isSaved ? t('market.unsave') : t('market.save')} aria-pressed={isSaved} className="market-card__save" data-selected={isSaved ? 'true' : undefined}>
                      <Heart className={`h-5 w-5 ${isSaved ? 'fill-current' : ''}`} aria-hidden="true" />
                    </AriaButton>
                    {isDemo && <span className="market-card__demo-mark"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t('market.demoBadge')}</span>}
                  </div>

                  <div className="market-card__body">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {listing.brand && <p className="market-card__brand">{listing.brand}</p>}
                        <h3 className="market-card__title">{listing.title}</h3>
                      </div>
                      <span className="market-card__condition">{listing.category}</span>
                    </div>
                    <div className="market-card__price-row">
                      <div>
                        <p className="market-card__price">{formatYen(listing.price)}</p>
                        <p className="market-card__shipping">{t('market.shippingIncluded', { eta: listing.shippingDays ?? t('market.shippingFallback') })}</p>
                      </div>
                      <span className={`market-card__gap ${priceGap <= 0 ? 'market-card__gap--good' : ''}`}><TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />{t('market.marketPrice', { price: formatYen(listing.marketMedianPrice) })}</span>
                    </div>
                    <div className="market-card__meta">
                      <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{t('market.listedDaysAgo', { count: listing.daysListed })}</span>
                      <span><Eye className="h-3.5 w-3.5" aria-hidden="true" />{formatNumber(listing.viewsCount)}</span>
                      <span><Heart className="h-3.5 w-3.5" aria-hidden="true" />{formatNumber(listing.likesCount)}</span>
                    </div>
                    <div className="market-card__footer">
                      <span className="market-card__seller"><span className="seller-avatar">{listing.sellerName.slice(0, 1)}</span>{listing.sellerName} <span className="text-amber-700">★{listing.sellerRating?.toFixed(1) ?? '4.8'}</span></span>
                      <AriaButton onPress={() => onSelectListing(listing)} className="market-card__action">{t('market.askPrice')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></AriaButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state mt-5"><Search className="h-6 w-6 text-slate-400" aria-hidden="true" /><p className="font-bold text-slate-800">{t('market.emptyTitle')}</p><p className="text-sm text-slate-500">{t('market.emptyBody')}</p></div>
        )}
      </section>

      <aside className="market-trust-panel shape-rail mt-8" aria-label={t('market.trustAria')}>
        <div><Tag className="h-5 w-5 text-coral-strong" aria-hidden="true" /><strong>{t('market.trustLimitTitle')}</strong><span>{t('market.trustLimitBody')}</span></div>
        <div><TrendingDown className="h-5 w-5 text-teal-800" aria-hidden="true" /><strong>{t('market.trustMarketTitle')}</strong><span>{t('market.trustMarketBody')}</span></div>
        <div><Bot className="h-5 w-5 text-plum-strong" aria-hidden="true" /><strong>{t('market.trustStopTitle')}</strong><span>{t('market.trustStopBody')}</span></div>
      </aside>
    </div>
  );
}
