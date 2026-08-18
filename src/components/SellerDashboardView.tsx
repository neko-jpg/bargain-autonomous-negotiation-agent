'use client';

import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { ArrowRight, CheckCircle2, Clock3, Eye, Heart, MessageSquare, ShieldCheck, Shuffle, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Listing, PublicNegotiationSession } from '@/types/negotiation';

interface SellerDashboardViewProps {
  listing: Listing;
  session?: PublicNegotiationSession;
  onOpenNegotiation?: () => void;
  onRerollListing?: () => void;
  onOpenListing?: () => void;
}

const conditionLabel: Record<Listing['condition'], string> = {
  new: '新品',
  like_new: 'ほぼ新品',
  good: '良好',
  fair: '使用感あり',
};

export function SellerDashboardView({ listing, session, onOpenNegotiation, onRerollListing, onOpenListing }: SellerDashboardViewProps) {
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
  const negotiationState = session?.status === 'deal' ? '成立' : session ? '進行中' : '待機中';

  return (
    <div className="seller-console page-container py-8 sm:py-10">
      <header className="seller-console__header">
        <div className="seller-console__heading">
          <p className="eyebrow">SELLER CONSOLE / 01</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">出品者向け管理</h1>
            <span className="seller-status-badge"><span className="seller-status-badge__dot" />公開中</span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">相場・反応・交渉状況を、ひとつの流れで確認できます。数字の意味と、次にできることを近くに置きました。</p>
        </div>
        <div className="seller-console__actions">
          {onRerollListing && <AriaButton onPress={onRerollListing} className="secondary-button seller-console__switch"><Shuffle className="h-4 w-4" aria-hidden="true" />別の商品を見る</AriaButton>}
          {onOpenNegotiation && <AriaButton onPress={onOpenNegotiation} className="primary-button seller-console__action"><MessageSquare className="h-4 w-4" aria-hidden="true" />交渉を開く<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
        </div>
      </header>

      <section className="seller-listing-card mt-7" aria-labelledby="seller-listing-title">
        <div className="seller-listing-card__image relative">
          <Image src={listing.imageUrl} alt={listing.title} fill sizes="(max-width: 767px) 100vw, 190px" className="object-cover" priority />
          <span className="seller-listing-card__image-tag">{listing.category}</span>
        </div>

        <div className="seller-listing-card__info">
          <div className="seller-listing-card__kicker"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> 出品中 · {conditionLabel[listing.condition]}</div>
          <h2 id="seller-listing-title" className="seller-listing-card__title">{listing.title}</h2>
          {onOpenListing && <AriaButton onPress={onOpenListing} className="seller-text-action seller-listing-card__open">商品詳細を見る<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
          <div className="seller-listing-card__price-line"><span>公開価格</span><strong>¥{listing.price.toLocaleString('ja-JP')}</strong></div>
          <div className="seller-listing-card__meta">
            <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{listing.daysListed}日掲載</span>
            <span><Eye className="h-3.5 w-3.5" aria-hidden="true" />{listing.viewsCount.toLocaleString('ja-JP')}閲覧</span>
            <span><Heart className="h-3.5 w-3.5" aria-hidden="true" />{listing.likesCount}いいね</span>
          </div>
        </div>

        <aside className="seller-market-summary" aria-label="相場との比較">
          <p className="eyebrow">MARKET POSITION</p>
          <div className="seller-market-summary__headline">
            <span>{marketGap > 0 ? '相場より上' : marketGap < 0 ? '相場より下' : '相場と同じ'}</span>
            <strong>{marketGapRate}%</strong>
          </div>
          <p className="seller-market-summary__note">相場中央値 ¥{listing.marketMedianPrice.toLocaleString('ja-JP')}</p>
          <PriceRail marketPosition={marketPosition} listingPosition={listingPosition} currentPosition={currentPosition} />
          <div className="seller-market-summary__legend"><span><i className="seller-marker seller-marker--market" />相場</span><span><i className="seller-marker seller-marker--listing" />公開</span></div>
        </aside>
      </section>

      <section className="seller-kpi-rail mt-5" aria-label="出品の反応指標">
        <Kpi icon={Eye} label="閲覧数" value={listing.viewsCount.toLocaleString('ja-JP')} hint="出品開始から" tone="teal" />
        <Kpi icon={Heart} label="いいね" value={String(listing.likesCount)} hint="購入検討の反応" tone="coral" />
        <Kpi icon={TrendingUp} label="相場中央値" value={`¥${listing.marketMedianPrice.toLocaleString('ja-JP')}`} hint={marketGap > 0 ? '公開価格が相場より上' : '公開価格が相場以内'} tone="mustard" />
        <Kpi icon={ShieldCheck} label="競合" value={`${listing.competingListingsCount}件`} hint={`${listing.daysListed}日経過`} tone="plum" />
      </section>

      <div className="seller-workspace mt-5">
        <section className="seller-negotiation-panel" aria-labelledby="seller-negotiation-title">
          <header className="seller-panel-heading">
            <div><p className="eyebrow">NEGOTIATION / LIVE</p><h2 id="seller-negotiation-title">現在の交渉</h2></div>
            <span className={`seller-live-state seller-live-state--${session?.status === 'deal' ? 'success' : session ? 'active' : 'idle'}`}><span />{negotiationState}</span>
          </header>

          {session ? (
            <div className="seller-negotiation-content">
              <div className="seller-offer-focus">
                <p className="seller-offer-focus__label">現在の提示</p>
                <strong>¥{currentPrice.toLocaleString('ja-JP')}</strong>
                <p className="seller-offer-focus__delta"><TrendingDown className="h-4 w-4" aria-hidden="true" />公開価格から ¥{Math.max(0, listing.price - currentPrice).toLocaleString('ja-JP')} 差</p>
                {latestOffer ? <p className="seller-offer-focus__message">「{latestOffer.messageText}」</p> : <p className="seller-offer-focus__message">買い手からの提案を待っています。</p>}
                {onOpenNegotiation && <AriaButton onPress={onOpenNegotiation} className="seller-text-action">交渉の詳細を見る<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
              </div>
              <div className="seller-activity-rail">
                <div className="seller-activity-rail__top"><span>ACTIVITY</span><strong>{session.offers.length}アクション</strong></div>
                <div className="seller-activity-rail__line" aria-hidden="true"><span className="seller-activity-rail__fill" style={{ width: `${Math.min(100, Math.max(12, session.offers.length * 18))}%` }} /></div>
                <div className="seller-activity-rail__steps"><span className="is-done"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />条件を確認</span><span className={session.offers.length > 0 ? 'is-done' : ''}><span className="seller-step-dot" />提案を観測</span><span className={session.status === 'deal' ? 'is-done' : ''}><span className="seller-step-dot" />合意を判断</span></div>
              </div>
            </div>
          ) : (
            <div className="seller-negotiation-empty">
              <div className="seller-negotiation-empty__signal"><span /><span /><span /></div>
              <div><strong>買い手からの提案を待機中</strong><p>交渉が始まると、最新の提示と判断ログがここに表示されます。</p></div>
              {onOpenNegotiation && <AriaButton onPress={onOpenNegotiation} className="seller-text-action">交渉画面を開く<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>}
            </div>
          )}
        </section>

        <aside className="seller-principles-panel" aria-labelledby="seller-principles-title">
          <div className="seller-panel-heading seller-panel-heading--compact"><div><p className="eyebrow">GUARDRAILS</p><h2 id="seller-principles-title">価格を守る仕組み</h2></div><ShieldCheck className="h-5 w-5 text-teal-800" aria-hidden="true" /></div>
          <p className="seller-principles-panel__lead">自動交渉は、あなたの最低ラインを越えて動きません。</p>
          <ul className="seller-principles-list">
            <li><CheckCircle2 aria-hidden="true" />最低価格を下回る提案は受けない</li>
            <li><CheckCircle2 aria-hidden="true" />相場や競合を偽装しない</li>
            <li><CheckCircle2 aria-hidden="true" />承認前に取引を確定しない</li>
            <li><CheckCircle2 aria-hidden="true" />判断理由をあとから確認できる</li>
          </ul>
          <div className="seller-principles-panel__footer"><span className="seller-policy-chip"><span />Private State 保持中</span><span>監査ログ対応</span></div>
        </aside>
      </div>
    </div>
  );
}

function PriceRail({ marketPosition, listingPosition, currentPosition }: { marketPosition: number; listingPosition: number; currentPosition: number }) {
  return (
    <div className="seller-price-rail" aria-label="相場と価格の位置">
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
