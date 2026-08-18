'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton, Switch as AriaSwitch } from 'react-aria-components';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Heart, Info, LockKeyhole, Plus, Share2, ShieldCheck, Sparkles, Star, TrendingDown, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { BuyerPolicy, Listing } from '@/types/negotiation';
import { DEFAULT_BUYER_POLICY_DEMO } from '@/lib/mockData';
import { DEMO_CATALOG_ID } from '@/lib/catalog/catalogAdapter';

interface ProductDetailViewProps {
  listing: Listing;
  onStartNegotiation: (policy: BuyerPolicy) => void;
  onBuyNow: (price: number) => Promise<void>;
}

const yen = (value: number) => `¥${Math.max(0, Math.round(value)).toLocaleString()}`;

export function ProductDetailView({ listing, onStartNegotiation, onBuyNow }: ProductDetailViewProps) {
  const [targetText, setTargetText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [deadlineDays, setDeadlineDays] = useState(3);
  const [autoNegotiate, setAutoNegotiate] = useState(true);
  const [autoPurchase, setAutoPurchase] = useState(false);
  const [delegationLevel, setDelegationLevel] = useState<1 | 2 | 3>(2);
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
    setAutoPurchase(false);
    setDelegationLevel(2);
    setLiked(false);
    setActiveImage(0);
  }, [listing.id, listing.price]);

  const target = Number(targetText);
  const maxPrice = Number(maxText);
  const errors = useMemo(() => {
    const result: { target?: string; max?: string } = {};
    if (!Number.isInteger(target) || target <= 0) result.target = '目標価格を入力してください。';
    if (!Number.isInteger(maxPrice) || maxPrice <= 0) result.max = '上限価格を入力してください。';
    if (!result.target && !result.max && target > maxPrice) result.target = '目標価格は上限価格以下にしてください。';
    if (!result.max && maxPrice > listing.price) result.max = `上限価格は出品価格 ${yen(listing.price)} 以下にしてください。`;
    return result;
  }, [listing.price, maxPrice, target]);

  const images = listing.images?.length ? listing.images : [listing.imageUrl];
  const expectedSaving = Number.isInteger(maxPrice) ? Math.max(0, listing.price - maxPrice) : 0;
  const marketGap = Math.round(((listing.price - listing.marketMedianPrice) / listing.marketMedianPrice) * 1000) / 10;
  const conditionLabel = { new: '新品', like_new: 'ほぼ新品', good: '良好', fair: '使用感あり' }[listing.condition];

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
      autoPurchase: autoPurchase && delegationLevel === 3,
      autoNegotiate,
      delegationLevel,
    });
  };

  const handleShare = async () => {
    const shareUrl = typeof window === 'undefined' ? '' : window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: listing.title, text: `BARGAINで見つけた商品: ${listing.title}`, url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        toast.success('商品ページのリンクをコピーしました。');
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
        <span>マーケット</span><span aria-hidden="true">/</span><span>{listing.category}</span><span aria-hidden="true">/</span><span className="truncate font-semibold text-slate-800">商品詳細</span>
      </div>

      <div className="product-detail-layout">
        <section aria-label="商品画像" className="product-detail-media-column">
          <div className="product-detail-media-card">
            <div className="product-detail-media-frame">
              <Image src={images[activeImage] ?? listing.imageUrl} alt={listing.title} fill priority fetchPriority="high" sizes="(max-width: 1023px) 100vw, 58vw" className="product-detail-main-image object-cover" />
              <div className="product-detail-verified-badge">
                <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
                出品者確認済み
              </div>
              <AriaButton type="button" aria-label={liked ? '保存を解除' : '商品を保存'} onPress={() => setLiked((value) => !value)} className="product-detail-favorite">
                <Heart className={`h-5 w-5 ${liked ? 'fill-rose-500 text-rose-500' : ''}`} aria-hidden="true" />
              </AriaButton>
              <AriaButton type="button" aria-label="前の画像" isDisabled={images.length <= 1} onPress={() => handleImageStep(-1)} className="product-detail-gallery-arrow product-detail-gallery-arrow--prev">
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </AriaButton>
              <AriaButton type="button" aria-label="次の画像" isDisabled={images.length <= 1} onPress={() => handleImageStep(1)} className="product-detail-gallery-arrow product-detail-gallery-arrow--next">
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </AriaButton>
            </div>

            <div className="product-detail-gallery">
              <div className="product-detail-thumbnails">
                {images.slice(0, 4).map((image, index) => (
                  <AriaButton key={`${image}-${index}`} type="button" aria-label={`商品画像${index + 1}を表示`} aria-current={index === activeImage ? 'true' : undefined} onPress={() => setActiveImage(index)} className={`product-detail-thumbnail ${index === activeImage ? 'is-active' : ''}`}>
                    <Image src={image} alt="" fill sizes="96px" className="object-cover" />
                  </AriaButton>
                ))}
                <AriaButton type="button" isDisabled aria-label="画像を追加（デモでは利用できません）" className="product-detail-thumbnail product-detail-thumbnail--add">
                  <Plus className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
                </AriaButton>
              </div>
            </div>
          </div>

          <div className="product-detail-metadata">
            <span className="inline-flex items-center gap-1.5"><Heart className="h-4 w-4" aria-hidden="true" />{listing.likesCount} いいね</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">◉</span>{listing.viewsCount.toLocaleString()} views</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" aria-hidden="true" />出品{listing.daysListed}日</span>
            <AriaButton type="button" onPress={handleShare} className="product-detail-share"><Share2 className="h-4 w-4" aria-hidden="true" />共有</AriaButton>
          </div>
        </section>

        <section className="product-detail-info-column">
          <div className="product-detail-info-card">
            <div className="product-detail-seller-row">
              <div className="product-detail-seller-main">
                <span className="product-detail-condition">{conditionLabel}</span>
                <span className="product-detail-seller-name">{listing.sellerName}</span>
                <span className="product-detail-rating"><Star className="h-4 w-4 fill-current" aria-hidden="true" />4.9</span>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <h1 className="product-detail-title mt-4">{listing.title}</h1>
            <p className="product-detail-price mt-4">{yen(listing.price)}</p>
            <div className="product-detail-market-row mt-3">
              <span className={`product-detail-market-pill ${marketGap > 0 ? 'is-above-market' : ''}`}>
                <TrendingDown className="h-4 w-4" aria-hidden="true" />相場中央値 {yen(listing.marketMedianPrice)}
              </span>
              <span className="text-slate-500">競合 {listing.competingListingsCount}件</span>
            </div>
            <p className="product-detail-description mt-5">{listing.description}</p>

            <form onSubmit={handleStart} className="product-detail-policy-card mt-7 p-5 sm:p-6">
              <div className="product-detail-policy-heading">
                <div><p className="eyebrow">NEGOTIATION POLICY</p><h2 className="mt-1 text-lg font-bold text-slate-950">交渉条件を設定</h2></div>
                <div className="product-detail-policy-icon"><Sparkles className="h-5 w-5" aria-hidden="true" /></div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="field-label">目標価格
                  <span className="relative mt-2 block"><span className="currency-prefix">¥</span><input id="target-price" name="targetPrice" inputMode="numeric" value={targetText} onChange={(event) => setTargetText(event.target.value.replace(/[^0-9]/g, ''))} aria-invalid={Boolean(errors.target)} aria-describedby={errors.target ? 'target-error' : undefined} className={`field-input pl-8 ${errors.target ? 'border-rose-500 ring-2 ring-rose-500/10' : ''}`} /></span>
                  {errors.target && <span id="target-error" className="field-error">{errors.target}</span>}
                </label>
                <label className="field-label">上限価格 <span className="font-normal text-slate-400">（非公開）</span>
                  <span className="relative mt-2 block"><span className="currency-prefix">¥</span><input id="max-price" name="maxPrice" inputMode="numeric" value={maxText} onChange={(event) => setMaxText(event.target.value.replace(/[^0-9]/g, ''))} aria-invalid={Boolean(errors.max)} aria-describedby={errors.max ? 'max-error' : undefined} className={`field-input pl-8 ${errors.max ? 'border-rose-500 ring-2 ring-rose-500/10' : ''}`} /></span>
                  {errors.max && <span id="max-error" className="field-error">{errors.max}</span>}
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="field-label">交渉期限
                  <select id="deadline-days" name="deadlineDays" value={deadlineDays} onChange={(event) => setDeadlineDays(Number(event.target.value))} className="field-input mt-2"><option value={1}>1日</option><option value={3}>3日</option><option value={7}>7日</option><option value={14}>14日</option></select>
                </label>
                <label className="field-label">委任レベル
                  <select id="delegation-level" name="delegationLevel" value={delegationLevel} onChange={(event) => setDelegationLevel(Number(event.target.value) as 1 | 2 | 3)} className="field-input mt-2"><option value={1}>Level 1：提案のみ</option><option value={2}>Level 2：交渉代行・購入確認</option><option value={3}>Level 3：完全委任</option></select>
                </label>
              </div>

              <div className="mt-5 space-y-1 border-t border-slate-200 pt-4">
                <AriaSwitch isSelected={autoNegotiate} onChange={setAutoNegotiate} className="switch-row"><span className="switch-track"><span className="switch-thumb" /></span><span><span className="block text-sm font-semibold text-slate-900">自動交渉を有効にする</span><span className="block text-sm font-normal text-slate-500">市場の変化に応じて、次の提案を自動作成します。</span></span></AriaSwitch>
                <AriaSwitch isSelected={autoPurchase && delegationLevel === 3} onChange={setAutoPurchase} isDisabled={delegationLevel !== 3} className="switch-row"><span className="switch-track"><span className="switch-thumb" /></span><span><span className="block text-sm font-semibold text-slate-900">合意後に購入確認を自動化</span><span className="block text-sm font-normal text-slate-500">Level 3のときだけ有効です。</span></span></AriaSwitch>
              </div>

              <div className="product-detail-privacy mt-5 flex items-start gap-3 rounded-xl p-4 text-sm"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" /><p>上限価格は相手に公開されません。BARGAINは設定した上限を超える提案を行いません。</p></div>
              <div aria-live="polite" className="product-detail-savings mt-5 flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm"><span className="font-semibold text-teal-900">想定最大削減額</span><span className="text-lg font-bold text-teal-800 tabular-nums">{yen(expectedSaving)}</span></div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <AriaButton type="submit" isDisabled={Object.keys(errors).length > 0} className="primary-button"><Zap className="h-4 w-4" aria-hidden="true" />AI交渉を開始<ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" /></AriaButton>
                <AriaButton type="button" onPress={handleBuy} isDisabled={isBuying} isPending={isBuying} className="secondary-button">{isBuying ? '準備中…' : '今すぐ購入'}</AriaButton>
              </div>
            </form>

            <div className="product-detail-benefits mt-5 grid gap-3 sm:grid-cols-3">
              {['価格上限を厳守', '交渉履歴を説明', 'いつでも停止可能'].map((item) => <div key={item} className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Check className="h-4 w-4 text-teal-700" aria-hidden="true" />{item}</div>)}
            </div>
          </div>
          <div className="product-detail-disclaimer mt-5 flex items-start gap-3 text-sm leading-6 text-slate-500"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>市場価格と勝率は過去データを使った推定値です。実際の成約を保証するものではありません。</p></div>
        </section>
      </div>
    </div>
  );
}
