'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { motion } from 'motion/react';
import { CheckCircle2, Download, ExternalLink, PackageCheck, ShieldCheck, Star, Truck } from 'lucide-react';
import { PublicDealSummary, Listing, NegotiationOfferView } from '@/types/negotiation';
import { NegotiationEventCard } from '@/components/NegotiationEventCard';
import { ContractDraftPanel } from '@/components/ContractDraftPanel';

interface DealSummaryViewProps {
  summary?: PublicDealSummary;
  listing: Listing;
  offers?: NegotiationOfferView[];
  buyerMaxPrice?: number;
  sellerSurplus?: number;
  negotiationId: string;
  onGoToDetail: () => void;
}

export function DealSummaryView({ summary, listing, offers = [], buyerMaxPrice, sellerSurplus, negotiationId, onGoToDetail }: DealSummaryViewProps) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const agreedPrice = summary?.agreedPrice ?? listing.price;
  const fee = Math.round(agreedPrice * 0.05);

  const submitFeedback = (event: FormEvent) => {
    event.preventDefault();
    if (!rating) return;
    setSubmitted(true);
  };

  const downloadReceipt = () => {
    const receipt = [`BARGAIN 取引確認`, `商品: ${listing.title}`, `合意価格: ¥${agreedPrice.toLocaleString()}`, `取引ID: ${listing.id}`, `日時: ${summary?.completedAt ?? new Date().toISOString()}`].join('\n');
    const url = URL.createObjectURL(new Blob([receipt], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bargain-receipt-${listing.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
            <p className="eyebrow">DEAL COMPLETE</p>
            <h1 id="deal-summary-title">交渉が成立しました</h1>
            <p>合意内容と交渉の全イベントを記録しました。</p>
          </div>
          <div className="deal-summary-hero__price-wrap">
            <span>合意価格</span>
            <strong>¥{agreedPrice.toLocaleString()}</strong>
          </div>
        </div>
        <div className="deal-summary-hero__metrics">
          <SummaryMetric tone="yellow" label="買い手の節約" value={`¥${(summary?.buyerSaved ?? 0).toLocaleString()}`} hint={`${summary?.buyerSavedPercent ?? 0}% OFF`} />
          <SummaryMetric tone="mint" label="売り手の余剰" value={sellerSurplus === undefined ? '非公開' : `+¥${sellerSurplus.toLocaleString()}`} hint={sellerSurplus === undefined ? '当事者のみ表示' : '最低価格との差'} />
          <SummaryMetric tone="surface" label="アクション" value={`${summary?.totalActions ?? offers.length}回`} hint="全イベント" />
          <SummaryMetric tone="rose" label="人間の介入" value={`${summary?.humanMessagesCount ?? 0}回`} hint="自動交渉" />
        </div>
      </motion.section>

      <div className="deal-summary-layout">
        <div className="deal-summary-main">
          <section className="deal-summary-panel deal-summary-order" aria-labelledby="order-summary-title">
            <div className="deal-summary-panel__heading">
              <div>
                <p className="eyebrow">ORDER SUMMARY</p>
                <h2 id="order-summary-title">商品・注文サマリー</h2>
              </div>
              <AriaButton aria-label="領収書をダウンロード" onPress={downloadReceipt} className="deal-summary-button deal-summary-button--secondary">
                <Download className="h-4 w-4" aria-hidden="true" />領収書
              </AriaButton>
            </div>

            <div className="deal-summary-product">
              <div className="deal-summary-product__image">
                <Image src={listing.imageUrl} alt="" fill sizes="80px" className="object-cover" />
              </div>
              <div className="min-w-0">
                <h3>{listing.title}</h3>
                <p>出品者: {listing.sellerName}</p>
              </div>
            </div>

            <div className="deal-summary-lines">
              <Line label="商品価格" value={`¥${agreedPrice.toLocaleString()}`} />
              {buyerMaxPrice && <Line label="設定した上限" value={`¥${buyerMaxPrice.toLocaleString()}`} />}
              <Line label="手数料（5%）" value={`¥${fee.toLocaleString()}`} />
              <Line label="送料" value="送料込み" />
              <Line label="お支払い合計" value={`¥${(agreedPrice + fee).toLocaleString()}`} strong />
            </div>
            <p className="deal-summary-note">この画面は購入確認用のモックです。実決済はまだ実行されません。</p>
          </section>

          <section className="deal-summary-panel deal-summary-history" aria-labelledby="audit-trail-title">
            <div className="deal-summary-panel__heading deal-summary-panel__heading--history">
              <div>
                <p className="eyebrow">AUDIT TRAIL</p>
                <h2 id="audit-trail-title">実際の交渉履歴</h2>
              </div>
              <span className="deal-summary-count">{offers.length}イベント</span>
            </div>

            <div className="deal-summary-events">
              {offers.length === 0 ? (
                <p className="deal-summary-empty">交渉履歴はありません。</p>
              ) : offers.map((offer, index) => <NegotiationEventCard key={offer.id} offer={offer} listing={listing} index={index} />)}
            </div>
          </section>
        </div>

        <aside className="deal-summary-side">
          <section className="deal-summary-panel deal-summary-steps" aria-labelledby="next-steps-title">
            <div className="deal-summary-panel__heading">
              <div>
                <p className="eyebrow">HANDOFF</p>
                <h2 id="next-steps-title">次のステップ</h2>
              </div>
              <span className="deal-summary-status">成立</span>
            </div>
            <div className="deal-summary-steps__list">
              <Step icon={PackageCheck} title="購入確認" body="合意内容を確認しました" done />
              <Step icon={Truck} title="発送待ち" body="出品者の発送を待ちます" />
              <Step icon={ShieldCheck} title="受取確認" body="商品を確認して評価します" />
            </div>
            <div className="deal-summary-actions">
              <AriaButton onPress={onGoToDetail} className="deal-summary-button deal-summary-button--primary">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />交渉履歴を詳しく見る
              </AriaButton>
              <AriaButton onPress={downloadReceipt} className="deal-summary-button deal-summary-button--secondary">
                <Download className="h-4 w-4" aria-hidden="true" />取引確認を保存
              </AriaButton>
            </div>
          </section>

          <section className="deal-summary-panel deal-summary-rating" aria-labelledby="rating-title">
            <div className="deal-summary-panel__heading">
              <div>
                <p className="eyebrow">FEEDBACK</p>
                <h2 id="rating-title">AI交渉を評価</h2>
              </div>
              <Star className="h-5 w-5" aria-hidden="true" />
            </div>
            {submitted ? (
              <p className="deal-summary-rating__success" aria-live="polite">評価を受け付けました。ありがとうございます。</p>
            ) : (
              <form onSubmit={submitFeedback} className="deal-summary-rating__form">
                <div className="deal-summary-rating__stars" aria-label="評価">
                  <span className="sr-only">1〜5つ星で評価</span>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <AriaButton key={value} type="button" aria-label={`${value}つ星`} onPress={() => setRating(value)} className={`deal-summary-rating__star ${value <= rating ? 'is-selected' : ''}`}>
                      <Star className="h-5 w-5" aria-hidden="true" />
                    </AriaButton>
                  ))}
                </div>
                <label className="deal-summary-rating__field">
                  <span className="sr-only">感想</span>
                  <textarea id="deal-feedback" name="feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={500} placeholder="感想があれば教えてください" />
                </label>
                <AriaButton type="submit" isDisabled={!rating} className="deal-summary-button deal-summary-button--primary w-full">評価を送信</AriaButton>
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
