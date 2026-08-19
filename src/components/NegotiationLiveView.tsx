'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, Info, Pause, Play, RotateCcw, Send, ShieldCheck, Square, TrendingDown, UserRound } from 'lucide-react';
import { PublicNegotiationSession } from '@/types/negotiation';

interface NegotiationLiveViewProps {
  session: PublicNegotiationSession;
  onUpdateSession: (session: PublicNegotiationSession) => void;
  onGoToDetail: () => void;
  onGoToDeal: () => void;
}

const yen = (value: number) => `¥${Math.round(value).toLocaleString()}`;

export function NegotiationLiveView({ session, onUpdateSession, onGoToDetail, onGoToDeal }: NegotiationLiveViewProps) {
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [humanPrice, setHumanPrice] = useState('');
  const [humanMessage, setHumanMessage] = useState('');
  const [remainingHours, setRemainingHours] = useState<number | null>(null);
  const requestInFlight = useRef(false);

  const actionableOffers = session.offers.filter((offer) => offer.actionType !== 'wait');
  const latestOffer = session.offers.at(-1);
  const latestActionableOffer = actionableOffers.at(-1);
  const currentPrice = latestActionableOffer?.price ?? session.listing.price;
  const latestReasoning = [...session.offers].reverse().find((offer) => offer.reasoning)?.reasoning;
  const viewerBuyerPolicy = session.viewer?.role === 'buyer' ? session.viewer.policy : undefined;
  const buyerMaxPrice = viewerBuyerPolicy && 'maxPrice' in viewerBuyerPolicy ? viewerBuyerPolicy.maxPrice : undefined;
  const buyerTargetPrice = viewerBuyerPolicy?.targetPrice;
  const isFinished = session.status === 'deal' || session.status === 'rejected';
  const lastOfferFromSeller = latestActionableOffer?.senderRole.includes('seller') ?? false;
  const canAccept = session.status === 'paused_for_human'
    && latestOffer?.actionType === 'ask_user'
    && !isFinished
    && (session.currentTurn !== 'buyer' || buyerMaxPrice === undefined || currentPrice <= buyerMaxPrice);

  useEffect(() => {
    if (session.status !== 'waiting' || !session.waitingUntilAt) {
      setRemainingHours(null);
      return;
    }
    const update = () => {
      const milliseconds = new Date(session.waitingUntilAt as string).getTime() - Date.now();
      setRemainingHours(Math.max(0, Math.ceil(milliseconds / 3_600_000)));
    };
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, [session.status, session.waitingUntilAt]);

  useEffect(() => {
    if (session.status !== 'deal') return;
    onGoToDeal();
  }, [onGoToDeal, session.status]);

  useEffect(() => {
    const source = new EventSource(`/api/negotiations/${session.id}/events`);
    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { session?: PublicNegotiationSession };
        if (payload.session) onUpdateSession(payload.session);
      } catch {
        // Ignore malformed heartbeat data and keep the local connection alive.
      }
    };
    source.addEventListener('session.updated', handleEvent);
    source.addEventListener('session.created', handleEvent);
    return () => source.close();
  }, [onUpdateSession, session.id]);

  const callAction = async (type: string, extra: Record<string, unknown> = {}) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setIsBusy(true);
    setErrorMessage('');
    try {
      const response = await fetch(`/api/negotiations/${session.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          expectedVersion: session.version,
          idempotencyKey: `${session.id}-${session.version}-${type}-${Date.now()}`,
          ...extra,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? '操作を完了できませんでした。');
      if (payload.session) onUpdateSession(payload.session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '操作を完了できませんでした。');
    } finally {
      requestInFlight.current = false;
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!isAutoPlaying || session.status !== 'active' || isFinished) return;
    const timer = window.setTimeout(() => void callAction('auto_step'), 2_000);
    return () => window.clearTimeout(timer);
    // callAction is intentionally kept stable through the session snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoPlaying, isFinished, session.status, session.version]);

  const status = useMemo(() => {
    if (session.status === 'deal') return { label: '合意成立', tone: 'success' };
    if (session.status === 'waiting') return { label: '市場を観測中', tone: 'warning' };
    if (session.status === 'paused_for_human') return { label: 'あなたの確認待ち', tone: 'info' };
    if (session.status === 'rejected') return { label: '交渉終了', tone: 'danger' };
    return { label: '自動交渉中', tone: 'active' };
  }, [session.status]);

  const submitHumanOffer = async (event: FormEvent) => {
    event.preventDefault();
    const price = Number(humanPrice);
    if (!Number.isInteger(price) || price <= 0) {
      setErrorMessage('有効な価格を入力してください。');
      return;
    }
    await callAction('human_offer', { offerPrice: price, messageText: humanMessage || undefined });
    setHumanPrice('');
    setHumanMessage('');
  };

  return (
    <div className="negotiation-live-page page-container py-8 sm:py-10">
      <div className="mb-7 flex items-center justify-between gap-4">
        <AriaButton onPress={onGoToDetail} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><ArrowLeft className="h-4 w-4" aria-hidden="true" />交渉詳細へ</AriaButton>
        <div className="flex items-center gap-3"><span className={`status-pill status-${status.tone}`}><span className="status-dot" />{status.label}</span><span className="hidden text-xs text-slate-400 sm:inline">更新 {new Date(session.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <section className="negotiation-panel box-neo-slant box-neo-slant--surface rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100"><Image src={session.listing.imageUrl} alt="" fill sizes="80px" className="object-cover" /></div>
                <div className="min-w-0"><p className="eyebrow">LIVE NEGOTIATION</p><h1 className="mt-1 line-clamp-2 text-xl font-bold leading-7 text-slate-950">{session.listing.title}</h1><p className="mt-1 text-sm text-slate-500">{session.listing.sellerName} · 出品価格 {yen(session.listing.price)}</p></div>
              </div>
              <div className="shrink-0 text-left sm:text-right"><p className="text-sm text-slate-500">現在の有効提示</p><p className="mt-1 text-3xl font-extrabold tracking-[-0.04em] text-slate-950 tabular-nums">{yen(currentPrice)}</p></div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <Metric label="あなたの目標" value={buyerTargetPrice === undefined ? '非公開' : yen(buyerTargetPrice)} hint={buyerTargetPrice === undefined ? '当事者のみ表示' : undefined} />
              <Metric label="あなたの上限" value={buyerMaxPrice === undefined ? '非公開' : yen(buyerMaxPrice)} hint="サーバー内でのみ検証" />
              <Metric label="相場中央値" value={yen(session.listing.marketMedianPrice)} hint={`${session.listing.daysListed}日経過`} />
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
              <AriaButton onPress={() => void callAction('auto_step')} isDisabled={isBusy || isFinished || session.status !== 'active'} isPending={isBusy} className="primary-button box-neo-slant negotiation-primary-action min-w-36">{isBusy ? <RotateCcw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}次の一手を実行</AriaButton>
              <AriaButton onPress={() => setIsAutoPlaying((value) => !value)} isDisabled={isFinished || session.status !== 'active'} className="secondary-button negotiation-control">{isAutoPlaying ? <><Pause className="h-4 w-4" aria-hidden="true" />自動実行を停止</> : <><Play className="h-4 w-4" aria-hidden="true" />自動実行</>}</AriaButton>
              {canAccept && latestOffer?.targetOfferId && <AriaButton onPress={() => void callAction('human_accept', { targetOfferId: latestOffer.targetOfferId, targetOfferVersion: latestOffer.targetOfferVersion })} isDisabled={isBusy} className="primary-button negotiation-control"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />この条件で承認</AriaButton>}
              {session.status === 'paused_for_human' ? <AriaButton onPress={() => void callAction('resume')} isDisabled={isBusy} className="secondary-button negotiation-control"><Play className="h-4 w-4" aria-hidden="true" />再開</AriaButton> : <AriaButton onPress={() => void callAction('pause')} isDisabled={isBusy || isFinished} className="secondary-button negotiation-control"><Pause className="h-4 w-4" aria-hidden="true" />一時停止</AriaButton>}
              <AriaButton onPress={() => void callAction('stop')} isDisabled={isBusy || isFinished} className="danger-button negotiation-control negotiation-control--danger"><Square className="h-4 w-4" aria-hidden="true" />交渉を終了</AriaButton>
            </div>

            {session.status === 'paused_for_human' && <div className="negotiation-notice mt-4 flex items-center gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" /><p>自動受諾の境界に達しました。提示条件を確認してから承認または再開してください。</p></div>}
            {session.status === 'waiting' && <div className="negotiation-notice negotiation-notice--waiting mt-4 flex items-center gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><Clock3 className="h-5 w-5 shrink-0" aria-hidden="true" /><p>市場を観測しています。{remainingHours === null ? `最大${session.waitingUntilHours ?? 6}時間` : remainingHours > 0 ? `あと約${remainingHours}時間` : '再評価できます'}。</p><AriaButton onPress={() => void callAction('time_skip', { waitHours: session.waitingUntilHours ?? 6 })} isDisabled={isBusy || (remainingHours !== null && remainingHours > 0)} className="negotiation-control negotiation-control--small ml-auto min-h-10 rounded-lg bg-white px-3 font-semibold text-amber-900 shadow-sm disabled:opacity-50">再評価</AriaButton></div>}
            {errorMessage && <div role="alert" className="negotiation-notice negotiation-notice--error mt-4 flex items-start gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />{errorMessage}</div>}
            <div className="sr-only" aria-live="polite">{status.label}</div>
          </section>

          <section className="negotiation-panel box-neo-slant box-neo-slant--surface mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-end justify-between gap-4"><div><p className="eyebrow">TIMELINE</p><h2 className="mt-1 text-xl font-bold text-slate-950">交渉の履歴</h2></div><span className="text-sm text-slate-500">{session.offers.length}アクション</span></div>
            {session.offers.length === 0 ? <EmptyState /> : <div className="mt-7 space-y-5"><AnimatePresence initial={false}>{session.offers.map((offer, index) => { const isBuyer = offer.senderRole.includes('buyer'); const isWait = offer.actionType === 'wait'; return <motion.article key={offer.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="relative flex gap-4"><div className="flex w-8 shrink-0 flex-col items-center"><span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${isBuyer ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'}`}>{isBuyer ? <UserRound className="h-4 w-4" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}</span>{index < session.offers.length - 1 && <span className="mt-1 h-full w-px bg-slate-200" />}</div><div className="negotiation-offer min-w-0 flex-1 rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-sm font-bold text-slate-900">{offer.senderName}</span><span className="ml-2 text-xs text-slate-400">Round {offer.round} · {offer.timestamp}</span></div><span className={`text-lg font-bold tabular-nums ${isWait ? 'text-amber-700' : 'text-slate-950'}`}>{isWait ? 'WAIT' : yen(offer.price)}</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{offer.messageText}</p>{offer.terms && <p className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded bg-slate-100 px-2 py-1">数量 {offer.terms.quantity}</span><span className="rounded bg-slate-100 px-2 py-1">送料 {yen(offer.terms.shippingCost)}</span><span className="rounded bg-slate-100 px-2 py-1">納期 {offer.terms.deliveryDays}日</span><span className="rounded bg-slate-100 px-2 py-1">{offer.terms.taxIncluded ? '税込' : '税別'} · {offer.terms.paymentTerms}</span></p>}{offer.reasoning && <details className="negotiation-reasoning mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold text-slate-700">判断理由を表示</summary><p className="mt-2 leading-6 text-slate-600">{offer.reasoning.summary}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-500">{offer.reasoning.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul></details>}</div></motion.article>; })}</AnimatePresence></div>}
          </section>

          {!isFinished && <form onSubmit={submitHumanOffer} className="negotiation-panel box-neo-slant box-neo-slant--surface mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex items-start gap-3"><div className="negotiation-form-icon rounded-lg bg-slate-100 p-2 text-slate-700"><Send className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="text-lg font-bold text-slate-950">条件を手動で提案</h2><p className="mt-1 text-sm text-slate-500">AIの提案を確認し、必要なときだけあなたの価格を送れます。</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-[160px_1fr_auto]"><label className="field-label">価格<input value={humanPrice} onChange={(event) => setHumanPrice(event.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="23000" className="field-input mt-2" /></label><label className="field-label">メッセージ<input value={humanMessage} onChange={(event) => setHumanMessage(event.target.value)} maxLength={280} placeholder="ご検討いただけますか？" className="field-input mt-2" /></label><AriaButton type="submit" isDisabled={isBusy} className="primary-button box-neo-slant negotiation-primary-action self-end">送信</AriaButton></div></form>}
        </div>

        <aside className="space-y-6">
          <section className="negotiation-panel box-neo-slant box-neo-slant--mint rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="eyebrow">NEXT ACTION</p><h2 className="mt-2 text-lg font-bold text-slate-950">{session.status === 'waiting' ? '市場の変化を待っています' : session.status === 'deal' ? '購入手続きへ進めます' : session.currentTurn === 'buyer' ? '買い手側の判断です' : '売り手側の応答を待っています'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{session.status === 'waiting' ? '待機後に市場データを再取得し、次の提案を作成します。' : session.status === 'deal' ? '合意内容を確認して取引を完了します。' : '上限価格と市場の状況を守りながら、次の一手を実行できます。'}</p><div className="negotiation-verification mt-5 flex items-center gap-3 rounded-xl bg-teal-50 p-3 text-sm text-teal-900"><CheckCircle2 className="h-5 w-5 text-teal-700" aria-hidden="true" />非公開条件をサーバーで検証済み</div></section>
          <section className="negotiation-panel box-neo-slant box-neo-slant--rose rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="eyebrow">ESTIMATE</p><h2 className="mt-2 text-lg font-bold text-slate-950">受諾スコア</h2></div><TrendingDown className="h-5 w-5 text-teal-700" aria-hidden="true" /></div><p className="mt-5 text-3xl font-extrabold text-slate-950 tabular-nums">{latestReasoning ? `${latestReasoning.acceptanceScore}%` : '—'}</p><p className="mt-1 text-sm text-slate-500">決定論的ヒューリスティック評価</p><div className="negotiation-progress mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: `${latestReasoning?.acceptanceScore ?? 0}%` }} /></div><p className="mt-3 text-xs leading-5 text-slate-500">校正済みの確率ではなく、相対的な判断スコアです。</p></section>
          <section className="negotiation-panel box-neo-slant box-neo-slant--surface rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-900">透明性のルール</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600"><li>・相場や競合情報を偽装しません</li><li>・非公開の上限価格を相手へ送りません</li><li>・いつでも一時停止・終了できます</li></ul></div></div><AriaButton onPress={onGoToDetail} className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800 hover:text-teal-950">判断ログを詳しく見る<ExternalLink className="h-4 w-4" aria-hidden="true" /></AriaButton></section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="negotiation-metric rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p>{hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}</div>;
}

function EmptyState() {
  return <div className="negotiation-empty-state mt-7 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><Clock3 className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" /><p className="mt-3 font-semibold text-slate-800">最初の一手を準備しています</p><p className="mt-1 text-sm text-slate-500">「次の一手を実行」から交渉を開始できます。</p></div>;
}
