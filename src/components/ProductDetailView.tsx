'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton, Switch as AriaSwitch } from 'react-aria-components';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Heart, Info, LockKeyhole, Plus, Share2, ShieldCheck, Sparkles, Star, TrendingDown, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { BuyerPolicy, Listing } from '@/types/negotiation';
import { DEFAULT_BUYER_POLICY_DEMO } from '@/lib/mockData';
import { DEMO_CATALOG_ID } from '@/lib/catalog/catalogAdapter';
import { conditionLabelKey } from '@/lib/i18n/labels';
import { useI18n } from '@/lib/i18n/provider';

interface ProductDetailViewProps {
  listing: Listing;
  onStartNegotiation: (policy: BuyerPolicy) => void;
  onBuyNow: (price: number) => Promise<void>;
}

export function ProductDetailView({ listing, onStartNegotiation, onBuyNow }: ProductDetailViewProps) {
  const { t, formatYen } = useI18n();
  const [targetText, setTargetText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [deadlineDays, setDeadlineDays] = useState(3);
  const [autoNegotiate, setAutoNegotiate] = useState(true);
  const [liked, setLiked] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [isBuying, setIsBuying] = useState(false);

  useEffect(() => {
    const target = listing.id === DEMO_CATALOG_ID ? DEFAULT_BUYER_POLICY_DEMO.targetPrice : Math.round(listing.price * 0.85);
    const maximum = listing.id === DEMO_CATALOG_ID ? DEFAULT_BUYER_POLICY_DEMO.maxPrice : Math.round(listing.price * 0.92);
    setTargetText(String(target));
    setMaxText(String(maximum));
    setDeadlineDays(3);
    setAutoNegotiate(true);
    setLiked(false);
    setActiveImage(0);
  }, [listing.id, listing.price]);

  const target = Number(targetText);
  const maxPrice = Number(maxText);
  const errors = useMemo(() => {
    const result: { target?: string; max?: string } = {};
    if (!Number.isInteger(target) || target <= 0) result.target = t('product.errorTargetRequired');
    if (!Number.isInteger(maxPrice) || maxPrice <= 0) result.max = t('product.errorMaxRequired');
    if (!result.target && !result.max && target > maxPrice) result.target = t('product.errorTargetAboveMax');
    if (!result.max && maxPrice > listing.price) result.max = t('product.errorMaxAboveListing', { price: formatYen(listing.price) });
    return result;
  }, [formatYen, listing.price, maxPrice, t, target]);

  const images = listing.images?.length ? listing.images : [listing.imageUrl];
  const expectedSaving = Number.isInteger(maxPrice) ? Math.max(0, listing.price - maxPrice) : 0;
  const marketGap = Math.round(((listing.price - listing.marketMedianPrice) / listing.marketMedianPrice) * 1000) / 10;

  const handleImageStep = (step: number) => {
    setActiveImage((current) => (current + step + images.length) % images.length);
  };

  const handleStart = (event: FormEvent) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0) return;
    onStartNegotiation({
      targetPrice: target,
      maxPrice,
      deadlineDays,
      autoPurchase: false,
      autoNegotiate,
    });
  };

  const handleShare = async () => {
    const shareUrl = typeof window === 'undefined' ? '' : window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: listing.title, text: t('product.shareText', { title: listing.title }), url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t('product.shareCopied'));
      }
    } catch {
      // User cancellation is intentionally silent.
    }
  };

  const handleBuy = async () => {
    setIsBuying(true);
    try {
      await onBuyNow(listing.price);
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="page-container product-detail-page py-6 sm:py-8">
      <div className="product-detail-breadcrumb mb-6 flex items-center gap-2 text-sm text-slate-500">
        <span>{t('product.breadcrumbMarket')}</span><span aria-hidden="true">/</span><span>{listing.category}</span><span aria-hidden="true">/</span><span className="truncate font-semibold text-slate-800">{t('product.breadcrumbDetail')}</span>
      </div>

      <div className="product-detail-layout">
        <section aria-label={t('product.breadcrumbDetail')} className="product-detail-media-column">
          <div className="product-detail-media-card">
            <div className="product-detail-media-frame">
              <Image src={images[activeImage] ?? listing.imageUrl} alt={listing.title} fill priority fetchPriority="high" sizes="(max-width: 1023px) 100vw, 58vw" className="product-detail-main-image object-cover" />
              <div className="product-detail-verified-badge">
                <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
                {t('product.verified')}
              </div>
              <AriaButton type="button" aria-label={liked ? t('market.unsave') : t('market.save')} onPress={() => setLiked((value) => !value)} className="product-detail-favorite">
                <Heart className={`h-5 w-5 ${liked ? 'fill-rose-500 text-rose-500' : ''}`} aria-hidden="true" />
              </AriaButton>
              <AriaButton type="button" aria-label={t('product.prevImage')} isDisabled={images.length <= 1} onPress={() => handleImageStep(-1)} className="product-detail-gallery-arrow product-detail-gallery-arrow--prev">
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </AriaButton>
              <AriaButton type="button" aria-label={t('product.nextImage')} isDisabled={images.length <= 1} onPress={() => handleImageStep(1)} className="product-detail-gallery-arrow product-detail-gallery-arrow--next">
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </AriaButton>
            </div>

            <div className="product-detail-gallery">
              <div className="product-detail-thumbnails">
                {images.slice(0, 4).map((image, index) => (
                  <AriaButton key={`${image}-${index}`} type="button" aria-label={t('product.imageAria', { n: index + 1 })} aria-current={index === activeImage ? 'true' : undefined} onPress={() => setActiveImage(index)} className={`product-detail-thumbnail ${index === activeImage ? 'is-active' : ''}`}>
                    <Image src={image} alt="" fill sizes="96px" className="object-cover" />
                  </AriaButton>
                ))}
                <AriaButton type="button" isDisabled aria-label={t('product.addImage')} className="product-detail-thumbnail product-detail-thumbnail--add">
                  <Plus className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
                </AriaButton>
              </div>
            </div>
          </div>

          <div className="product-detail-metadata">
            <span className="inline-flex items-center gap-1.5"><Heart className="h-4 w-4" aria-hidden="true" />{t('product.likes', { count: listing.likesCount })}</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">◉</span>{t('product.views', { count: listing.viewsCount })}</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" aria-hidden="true" />{t('product.listedDays', { count: listing.daysListed })}</span>
            <AriaButton type="button" onPress={handleShare} className="product-detail-share"><Share2 className="h-4 w-4" aria-hidden="true" />{t('product.share')}</AriaButton>
          </div>
        </section>

        <section className="product-detail-info-column">
          <div className="product-detail-info-card">
            <div className="product-detail-seller-row">
              <div className="product-detail-seller-main">
                <span className="product-detail-condition">{t(conditionLabelKey(listing.condition) ?? 'enum.condition.good')}</span>
                <span className="product-detail-seller-name">{listing.sellerName}</span>
                <span className="product-detail-rating"><Star className="h-4 w-4 fill-current" aria-hidden="true" />4.9</span>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <h1 className="product-detail-title mt-4">{listing.title}</h1>
            <p className="product-detail-price mt-4">{formatYen(listing.price)}</p>
            <div className="product-detail-market-row mt-3">
              <span className={`product-detail-market-pill ${marketGap > 0 ? 'is-above-market' : ''}`}>
                <TrendingDown className="h-4 w-4" aria-hidden="true" />{t('product.marketMedian', { price: formatYen(listing.marketMedianPrice) })}
              </span>
              <span className="text-slate-500">{t('product.competing', { count: listing.competingListingsCount })}</span>
            </div>
            <p className="product-detail-description mt-5">{listing.description}</p>

            <form onSubmit={handleStart} className="product-detail-policy-card mt-7 p-5 sm:p-6">
              <div className="product-detail-policy-heading">
                <div><p className="eyebrow">{t('product.policyEyebrow')}</p><h2 className="mt-1 text-lg font-bold text-slate-950">{t('product.policyTitle')}</h2></div>
                <div className="product-detail-policy-icon"><Sparkles className="h-5 w-5" aria-hidden="true" /></div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="field-label">{t('product.targetPrice')}
                  <span className="relative mt-2 block"><span className="currency-prefix">¥</span><input id="target-price" name="targetPrice" inputMode="numeric" value={targetText} onChange={(event) => setTargetText(event.target.value.replace(/[^0-9]/g, ''))} aria-invalid={Boolean(errors.target)} aria-describedby={errors.target ? 'target-error' : undefined} className={`field-input pl-8 ${errors.target ? 'border-rose-500 ring-2 ring-rose-500/10' : ''}`} /></span>
                  {errors.target && <span id="target-error" className="field-error">{errors.target}</span>}
                </label>
                <label className="field-label">{t('product.maxPrice')} <span className="font-normal text-slate-400">{t('product.maxPriceHint')}</span>
                  <span className="relative mt-2 block"><span className="currency-prefix">¥</span><input id="max-price" name="maxPrice" inputMode="numeric" value={maxText} onChange={(event) => setMaxText(event.target.value.replace(/[^0-9]/g, ''))} aria-invalid={Boolean(errors.max)} aria-describedby={errors.max ? 'max-error' : undefined} className={`field-input pl-8 ${errors.max ? 'border-rose-500 ring-2 ring-rose-500/10' : ''}`} /></span>
                  {errors.max && <span id="max-error" className="field-error">{errors.max}</span>}
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="field-label">{t('product.deadline')}
                  <select id="deadline-days" name="deadlineDays" value={deadlineDays} onChange={(event) => setDeadlineDays(Number(event.target.value))} className="field-input mt-2"><option value={1}>{t('product.deadlineDays', { count: 1 })}</option><option value={3}>{t('product.deadlineDays', { count: 3 })}</option><option value={7}>{t('product.deadlineDays', { count: 7 })}</option><option value={14}>{t('product.deadlineDays', { count: 14 })}</option></select>
                </label>
              </div>

              <div className="mt-5 space-y-1 border-t border-slate-200 pt-4">
                <AriaSwitch isSelected={autoNegotiate} onChange={setAutoNegotiate} className="switch-row"><span className="switch-track"><span className="switch-thumb" /></span><span><span className="block text-sm font-semibold text-slate-900">{t('product.autoNegotiate')}</span><span className="block text-sm font-normal text-slate-500">{t('product.autoNegotiateHint')}</span></span></AriaSwitch>
                <p className="px-1 py-2 text-sm text-slate-600">{t('product.approvalNote')}</p>
              </div>

              <div className="product-detail-privacy mt-5 flex items-start gap-3 rounded-xl p-4 text-sm"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" /><p>{t('product.privacyNote')}</p></div>
              <div aria-live="polite" className="product-detail-savings mt-5 flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm"><span className="font-semibold text-teal-900">{t('product.expectedSaving')}</span><span className="text-lg font-bold text-teal-800 tabular-nums">{formatYen(expectedSaving)}</span></div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <AriaButton type="submit" isDisabled={Object.keys(errors).length > 0} className="primary-button"><Zap className="h-4 w-4" aria-hidden="true" />{t('product.startNegotiation')}<ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" /></AriaButton>
                <AriaButton type="button" onPress={handleBuy} isDisabled={isBuying} isPending={isBuying} className="secondary-button">{isBuying ? t('product.preparing') : t('product.buyNow')}</AriaButton>
              </div>
            </form>

            <div className="product-detail-benefits mt-5 grid gap-3 sm:grid-cols-3">
              {[t('product.benefitLimit'), t('product.benefitHistory'), t('product.benefitStop')].map((item) => <div key={item} className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Check className="h-4 w-4 text-teal-700" aria-hidden="true" />{item}</div>)}
            </div>
          </div>
          <div className="product-detail-disclaimer mt-5 flex items-start gap-3 text-sm leading-6 text-slate-500"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{t('product.disclaimer')}</p></div>
        </section>
      </div>
    </div>
  );
}
