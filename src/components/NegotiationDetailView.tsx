'use client';

import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { ArrowLeft, BarChart3, CheckCircle2, Clock3, ShieldCheck, TrendingDown } from 'lucide-react';
import { PublicNegotiationSession } from '@/types/negotiation';
import { NegotiationEventCard } from '@/components/NegotiationEventCard';

interface NegotiationDetailViewProps {
  session: PublicNegotiationSession;
  onBackToLive: () => void;
}

export function NegotiationDetailView({ session, onBackToLive }: NegotiationDetailViewProps) {
  const latestReasoning = [...session.offers].reverse().find((offer) => offer.reasoning)?.reasoning;
  const actionableOffers = session.offers.filter((offer) => offer.actionType !== 'wait');
  const totalChange = actionableOffers.length > 1 ? actionableOffers[0].price - actionableOffers.at(-1)!.price : 0;

  return (
    <div className="negotiation-detail-page page-container py-8 sm:py-10">
      <div className="mb-7 flex items-center justify-between gap-4"><AriaButton onPress={onBackToLive} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" aria-hidden="true" />ライブ交渉へ戻る</AriaButton><span className="status-pill status-info"><span className="status-dot" />監査可能な判断ログ</span></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="negotiation-panel box-neo-slant box-neo-slant--surface rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-4"><div className="relative h-16 w-16 overflow-hidden rounded-xl bg-slate-100"><Image src={session.listing.imageUrl} alt="" fill sizes="64px" className="object-cover" /></div><div><p className="eyebrow">NEGOTIATION ANALYSIS</p><h1 className="mt-1 text-xl font-bold text-slate-950">判断ログと価格推移</h1><p className="mt-1 text-sm text-slate-500">{session.listing.title}</p></div></div>
          <div className="mt-7 grid gap-3 sm:grid-cols-3"><Summary label="アクション数" value={`${session.offers.length}回`} /><Summary label="開始価格" value={`¥${session.listing.price.toLocaleString()}`} /><Summary label="最終提示" value={session.currentOfferPrice ? `¥${session.currentOfferPrice.toLocaleString()}` : '—'} /></div>
          <div className="mt-8 border-t border-slate-200 pt-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-950">価格の推移</h2><span className={`text-sm font-semibold ${totalChange >= 0 ? 'text-teal-700' : 'text-amber-700'}`}>{totalChange >= 0 ? '買い手に有利' : '売り手に有利'}</span></div><div className="mt-6 space-y-3">{session.offers.map((offer) => <div key={offer.id} className="flex items-center gap-3"><span className="w-16 text-xs text-slate-400">Round {offer.round}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.min(100, Math.max(8, (offer.price / session.listing.price) * 100))}%` }} /></div><span className="w-24 text-right text-sm font-bold tabular-nums text-slate-800">¥{offer.price.toLocaleString()}</span></div>)}</div></div>
          <div className="mt-8 border-t border-slate-200 pt-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-950">イベント詳細</h2><span className="text-sm text-slate-500">タップで展開</span></div><div className="mt-5 grid gap-3">{session.offers.map((offer, index) => <NegotiationEventCard key={offer.id} offer={offer} listing={session.listing} index={index} />)}</div></div>
        </section>
        <aside className="space-y-6"><section className="negotiation-panel box-neo-slant box-neo-slant--rose rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-teal-800"><BarChart3 className="h-5 w-5" aria-hidden="true" /><h2 className="font-bold">最新の評価</h2></div><p className="mt-5 text-3xl font-extrabold text-slate-950">{latestReasoning ? `${latestReasoning.acceptanceScore}%` : '—'}</p><p className="mt-1 text-sm text-slate-500">受諾スコア</p>{latestReasoning && <p className="mt-4 text-sm leading-6 text-slate-600">{latestReasoning.summary}</p>}</section><section className="negotiation-panel box-neo-slant box-neo-slant--surface rounded-2xl border border-slate-200 bg-slate-50 p-5"><h2 className="font-bold text-slate-900">安全性チェック</h2><div className="mt-4 space-y-3 text-sm text-slate-600"><p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-teal-700" aria-hidden="true" />価格上限を超える提案なし</p><p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />相手に非公開条件を送信していない</p><p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-teal-700" aria-hidden="true" />待機時間をイベントとして記録</p></div></section></aside>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="negotiation-metric rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-950">{value}</p></div>; }
