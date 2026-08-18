'use client';

import { useMemo, useState, useTransition } from 'react';
import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { ArrowUpRight, Bot, ChevronDown, Clock3, Eye, Heart, PackageOpen, Search, Sparkles, Tag, TrendingDown } from 'lucide-react';
import { CATALOG_LISTING_COUNT, DEMO_CATALOG_ID, getCatalogCategories, type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';
import { Listing } from '@/types/negotiation';

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

const conditionLabel: Record<Listing['condition'], string> = {
  new: '新品',
  like_new: 'ほぼ新品',
  good: '良好',
  fair: '使用感あり',
};

const accentClasses = ['market-accent-coral', 'market-accent-teal', 'market-accent-mustard', 'market-accent-plum', 'market-accent-jade'];
const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`;

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

  return (
    <div className="page-container py-6 sm:py-9">
      <section className="market-hero shape-editorial" aria-labelledby="market-title">
        <div className="market-hero__copy">
          <div className="eyebrow market-hero__eyebrow"><Sparkles className="h-4 w-4" aria-hidden="true" /> CURATED CATALOG / 50 ITEMS</div>
          <h1 id="market-title" className="text-page-title mt-3 max-w-2xl text-slate-950 sm:text-4xl">欲しいものを見つけたら、<br /><span className="text-coral-strong">「いくらなら買うか」</span>から始める。</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">相場・出品日数・需要を確認しながら、あなたの上限価格を守った交渉を設定できます。デモ商品も実データのカタログから選べます。</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <AriaButton onPress={onRunDemo} isDisabled={isDemoRunning} isPending={isDemoRunning} className="primary-button shape-ticket">
              <Bot className="h-4 w-4" aria-hidden="true" />
              {isDemoRunning ? '6-Stepを実行中…' : '6-Stepデモを見る'}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </AriaButton>
            <AriaButton onPress={onRunApiNegotiation} isDisabled={isApiNegotiationStarting} isPending={isApiNegotiationStarting} className="secondary-button shape-ticket">
              <Bot className="h-4 w-4" aria-hidden="true" />
              {isApiNegotiationStarting ? 'API交渉を開始中…' : '実APIで交渉開始'}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </AriaButton>
            <span className="market-hero__note"><PackageOpen className="h-4 w-4" aria-hidden="true" /> {CATALOG_LISTING_COUNT}件の画像・商品データを同期済み</span>
          </div>
        </div>
        <div className="market-hero__stamp" aria-hidden="true"><span>価格相談</span><strong>OK</strong><small>Private State</small></div>
      </section>

      <section className="mt-7" aria-labelledby="catalog-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">BROWSE THE CATALOG</p>
            <h2 id="catalog-heading" className="mt-1 text-section-title text-slate-950">商品を探す <span className="ml-1 text-sm font-normal text-slate-500">{visibleListings.length}件</span></h2>
          </div>
          <label className="market-sort">
            <span className="sr-only">並び順</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
              <option value="recommended">おすすめ順</option>
              <option value="price-asc">価格の安い順</option>
              <option value="price-desc">価格の高い順</option>
              <option value="likes">いいねの多い順</option>
            </select>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </label>
        </div>

        <div className="category-strip" role="tablist" aria-label="商品カテゴリ">
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
                <span>{category.label}</span><small>{category.count}</small>
              </AriaButton>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3" aria-live="polite">
          <p className="text-sm text-slate-500">{activeCategory === 'all' ? '全カテゴリ' : categories.find((category) => category.id === activeCategory)?.label}から選択中</p>
          {(isPending || isFiltering) && <span className="inline-flex items-center gap-2 text-xs font-bold text-teal-800"><span className="loading-dot" />絞り込み中…</span>}
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
                    <AriaButton onPress={() => onSelectListing(listing)} aria-label={`${listing.title}の詳細を見る`} className="market-card__media">
                      <Image src={listing.imageUrl} alt={listing.title} fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw" loading={index < 4 ? 'eager' : 'lazy'} className="object-cover" />
                    </AriaButton>
                    <div className="market-card__media-label"><span>{conditionLabel[listing.condition]}</span>{listing.subcategory && <span>{listing.subcategory}</span>}</div>
                    <AriaButton onPress={() => toggleSaved(listing.id)} aria-label={isSaved ? '保存を解除' : '商品を保存'} aria-pressed={isSaved} className="market-card__save" data-selected={isSaved ? 'true' : undefined}>
                      <Heart className={`h-5 w-5 ${isSaved ? 'fill-current' : ''}`} aria-hidden="true" />
                    </AriaButton>
                    {isDemo && <span className="market-card__demo-mark"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />6-Step対象</span>}
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
                        <p className="market-card__price">{yen(listing.price)}</p>
                        <p className="market-card__shipping">送料込み・{listing.shippingDays ?? '2〜3日で発送'}</p>
                      </div>
                      <span className={`market-card__gap ${priceGap <= 0 ? 'market-card__gap--good' : ''}`}><TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />相場 {yen(listing.marketMedianPrice)}</span>
                    </div>
                    <div className="market-card__meta">
                      <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{listing.daysListed}日前</span>
                      <span><Eye className="h-3.5 w-3.5" aria-hidden="true" />{listing.viewsCount.toLocaleString('ja-JP')}</span>
                      <span><Heart className="h-3.5 w-3.5" aria-hidden="true" />{listing.likesCount}</span>
                    </div>
                    <div className="market-card__footer">
                      <span className="market-card__seller"><span className="seller-avatar">{listing.sellerName.slice(0, 1)}</span>{listing.sellerName} <span className="text-amber-700">★{listing.sellerRating?.toFixed(1) ?? '4.8'}</span></span>
                      <AriaButton onPress={() => onSelectListing(listing)} className="market-card__action">価格相談 <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></AriaButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state mt-5"><Search className="h-6 w-6 text-slate-400" aria-hidden="true" /><p className="font-bold text-slate-800">このカテゴリの商品はありません</p><p className="text-sm text-slate-500">カテゴリを変えてもう一度お試しください。</p></div>
        )}
      </section>

      <aside className="market-trust-panel shape-rail mt-8" aria-label="BARGAINの特徴">
        <div><Tag className="h-5 w-5 text-coral-strong" aria-hidden="true" /><strong>上限価格を守る</strong><span>Private Stateは相手に公開されません</span></div>
        <div><TrendingDown className="h-5 w-5 text-teal-800" aria-hidden="true" /><strong>相場を見ながら提案</strong><span>商品ごとの価格差を確認できます</span></div>
        <div><Bot className="h-5 w-5 text-plum-strong" aria-hidden="true" /><strong>途中で止められる</strong><span>交渉ログと判断理由をあとから確認</span></div>
      </aside>
    </div>
  );
}
