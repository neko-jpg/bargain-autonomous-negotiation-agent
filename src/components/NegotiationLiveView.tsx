'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton } from 'react-aria-components';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, Info, Pause, Play, RotateCcw, Send, ShieldCheck, Square, TrendingDown, UserRound } from 'lucide-react';
import { PublicNegotiationSession } from '@/types/negotiation';
import { localizeMessage, localizeReasoning, localizeSenderName } from '@/lib/i18n/content';
import { statusLabelKey } from '@/lib/i18n/labels';
import { useI18n } from '@/lib/i18n/provider';

interface NegotiationLiveViewProps {
  session: PublicNegotiationSession;
  onUpdateSession: (session: PublicNegotiationSession) => void;
  onGoToDetail: () => void;
  onGoToDeal: () => void;
}

export function NegotiationLiveView({ session, onUpdateSession, onGoToDetail, onGoToDeal }: NegotiationLiveViewProps) {
  const { t, formatYen, formatTime, formatDateTime } = useI18n();
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [humanPrice, setHumanPrice] = useState('');
  const [humanMessage, setHumanMessage] = useState('');
  const [remainingHours, setRemainingHours] = useState<number | null>(null);
  const requestInFlight = useRef(false);
  const latestVersion = useRef(session.version);
  useEffect(() => { latestVersion.current = session.version; }, [session.version]);

  const actionableOffers = session.offers.filter((offer) => offer.actionType !== 'wait');
  const latestOffer = session.offers.at(-1);
  const latestActionableOffer = actionableOffers.at(-1);
  const currentPrice = latestActionableOffer?.price ?? session.listing.price;
  const latestReasoning = [...session.offers].reverse().find((offer) => offer.reasoning)?.reasoning;
  const viewerBuyerPolicy = session.viewer?.role === 'buyer' ? session.viewer.policy : undefined;
  const buyerMaxPrice = viewerBuyerPolicy && 'maxPrice' in viewerBuyerPolicy ? viewerBuyerPolicy.maxPrice : undefined;
  const buyerTargetPrice = viewerBuyerPolicy?.targetPrice;
  const isFinished = session.status === 'deal' || session.status === 'rejected';
  const isMyTurn = session.viewer?.role === session.currentTurn;
  // Only the party whose turn it is may accept; the server enforces the same rule.
  const canAccept = session.status === 'paused_for_human'
    && latestOffer?.actionType === 'ask_user'
    && !isFinished
    && isMyTurn
    && (buyerMaxPrice === undefined || currentPrice <= buyerMaxPrice);
  const pendingCommit = session.pendingCommit;
  const resultUnknown = ['EFFECT_EXECUTION_FAILED', 'EFFECT_RESULT_UNKNOWN', 'EFFECT_IN_PROGRESS'].includes(pendingCommit?.blockedReason ?? '');
  const mustApproveCommit = session.status === 'awaiting_commit' && Boolean(session.viewer?.mustApproveCommit);

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
        // Ignore snapshots older than what the page already shows.
        if (payload.session && payload.session.version >= latestVersion.current) onUpdateSession(payload.session);
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
      if (!response.ok) throw new Error(payload.message ?? t('live.actionFailed'));
      if (payload.session) onUpdateSession(payload.session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('live.actionFailed'));
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
    const tone = session.status === 'deal' ? 'success'
      : session.status === 'waiting' ? 'warning'
      : session.status === 'paused_for_human' || session.status === 'awaiting_commit' ? 'info'
      : session.status === 'rejected' ? 'danger'
      : 'active';
    return { label: t(statusLabelKey(session.status) ?? 'enum.status.active'), tone };
  }, [session.status, t]);

  const submitHumanOffer = async (event: FormEvent) => {
    event.preventDefault();
    const price = Number(humanPrice);
    if (!Number.isInteger(price) || price <= 0) {
      setErrorMessage(t('live.invalidPrice'));
      return;
    }
    await callAction('human_offer', { offerPrice: price, messageText: humanMessage || undefined });
    setHumanPrice('');
    setHumanMessage('');
  };

  const waitingNotice = remainingHours === null
    ? t('live.waitingNoticeMax', { hours: session.waitingUntilHours ?? 6 })
    : remainingHours > 0
      ? t('live.waitingNoticeRemaining', { hours: remainingHours })
      : t('live.waitingNoticeReady');

  const commitBlockedMessage = resultUnknown
    ? t('live.commitBlockedUnknown')
    : pendingCommit?.blockedReason === 'KILL_SWITCH_ENGAGED'
      ? t('live.commitBlockedKillSwitch')
      : pendingCommit?.blockedReason === 'COMMIT_REQUIRES_NEW_APPROVAL'
        ? t('live.commitBlockedStale')
        : t('live.commitBlockedOther', { reason: pendingCommit?.blockedReason ?? '' });

  const approvalStatus = pendingCommit
    ? pendingCommit.approvals.length === 0
      ? t('live.approvalPending')
      : pendingCommit.approvals
          .map((approval) => `${approval.role === 'buyer' ? t('live.approvalBuyer') : t('live.approvalSeller')} ${approval.granted ? t('live.approvalGranted') : t('live.approvalMissing')}`)
          .join(' / ')
    : '';

  return (
    <div className="negotiation-live-page page-container py-8 sm:py-10">
      <div className="mb-7 flex items-center justify-between gap-4">
        <AriaButton onPress={onGoToDetail} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('live.backToDetail')}</AriaButton>
        <div className="flex items-center gap-3"><span className={`status-pill status-${status.tone}`}><span className="status-dot" />{status.label}</span><span className="hidden text-xs text-slate-400 sm:inline">{t('live.updated', { time: formatTime(session.updatedAt) })}</span></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <section className="negotiation-panel box-neo-slant box-neo-slant--surface rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100"><Image src={session.listing.imageUrl} alt="" fill sizes="80px" className="object-cover" /></div>
                <div className="min-w-0"><p className="eyebrow">LIVE NEGOTIATION</p><h1 className="mt-1 line-clamp-2 text-xl font-bold leading-7 text-slate-950">{session.listing.title}</h1><p className="mt-1 text-sm text-slate-500">{t('live.listedPrice', { seller: session.listing.sellerName, price: formatYen(session.listing.price) })}</p></div>
              </div>
              <div className="shrink-0 text-left sm:text-right"><p className="text-sm text-slate-500">{t('live.currentOffer')}</p><p className="mt-1 text-3xl font-extrabold tracking-[-0.04em] text-slate-950 tabular-nums">{formatYen(currentPrice)}</p></div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <Metric label={t('live.yourTarget')} value={buyerTargetPrice === undefined ? t('common.private') : formatYen(buyerTargetPrice)} hint={buyerTargetPrice === undefined ? t('common.privateHint') : undefined} />
              <Metric label={t('live.yourMax')} value={buyerMaxPrice === undefined ? t('common.private') : formatYen(buyerMaxPrice)} hint={t('live.serverVerifiedHint')} />
              <Metric label={t('live.marketMedian')} value={formatYen(session.listing.marketMedianPrice)} hint={t('live.daysElapsed', { count: session.listing.daysListed })} />
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
              <AriaButton onPress={() => void callAction('auto_step')} isDisabled={isBusy || isFinished || session.status !== 'active'} isPending={isBusy} className="primary-button box-neo-slant negotiation-primary-action min-w-36">{isBusy ? <RotateCcw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}{t('live.nextStep')}</AriaButton>
              <AriaButton onPress={() => setIsAutoPlaying((value) => !value)} isDisabled={isFinished || session.status !== 'active'} className="secondary-button negotiation-control">{isAutoPlaying ? <><Pause className="h-4 w-4" aria-hidden="true" />{t('live.stopAuto')}</> : <><Play className="h-4 w-4" aria-hidden="true" />{t('live.startAuto')}</>}</AriaButton>
              {canAccept && latestOffer?.targetOfferId && <AriaButton onPress={() => void callAction('human_accept', { targetOfferId: latestOffer.targetOfferId, targetOfferVersion: latestOffer.targetOfferVersion })} isDisabled={isBusy} className="primary-button negotiation-control"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('live.accept')}</AriaButton>}
              {session.status === 'awaiting_commit' ? null : session.status === 'paused_for_human' ? <AriaButton onPress={() => void callAction('resume')} isDisabled={isBusy} className="secondary-button negotiation-control"><Play className="h-4 w-4" aria-hidden="true" />{t('live.resume')}</AriaButton> : <AriaButton onPress={() => void callAction('pause')} isDisabled={isBusy || isFinished} className="secondary-button negotiation-control"><Pause className="h-4 w-4" aria-hidden="true" />{t('live.pause')}</AriaButton>}
              <AriaButton onPress={() => void callAction('stop')} isDisabled={isBusy || isFinished} className="danger-button negotiation-control negotiation-control--danger"><Square className="h-4 w-4" aria-hidden="true" />{t('live.stop')}</AriaButton>
            </div>

            {session.status === 'awaiting_commit' && pendingCommit && <div className="negotiation-notice mt-4 rounded-xl bg-teal-50 p-4 text-sm text-teal-900" role="region" aria-label={t('live.commitAria')}>
              <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><div><p className="font-bold">{resultUnknown ? t('live.commitResultUnknown') : t('live.commitAgreed')}</p><p className="mt-1">{t('live.commitSummary', { total: formatYen(pendingCommit.amount), price: formatYen(pendingCommit.price), shipping: formatYen(pendingCommit.shippingCost) })}</p>{session.viewer?.commitApprovalReason && <p className="mt-1 text-teal-800">{session.viewer.commitApprovalReason}</p>}{pendingCommit.blockedReason && <p className="mt-1 font-semibold text-rose-700">{commitBlockedMessage}</p>}<p className="mt-1 text-xs text-teal-700">{t('live.approvalStatus', { status: approvalStatus })} · {t('offer.expires', { date: formatDateTime(pendingCommit.expiresAt) })}</p></div></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {mustApproveCommit && <AriaButton onPress={() => void callAction('approve_commit', { intentHash: pendingCommit.intentHash })} isDisabled={isBusy} className="primary-button negotiation-control"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('live.approveCommit')}</AriaButton>}
                {(mustApproveCommit || session.viewer) && <AriaButton onPress={() => void callAction('reject_commit', { intentHash: pendingCommit.intentHash })} isDisabled={isBusy} className="secondary-button negotiation-control">{t('live.rejectCommit')}</AriaButton>}
                {pendingCommit.blockedReason && !resultUnknown && pendingCommit.blockedReason !== 'COMMIT_REQUIRES_NEW_APPROVAL' && <AriaButton onPress={() => void callAction('retry_commit')} isDisabled={isBusy} className="secondary-button negotiation-control"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('common.retry')}</AriaButton>}
              </div>
            </div>}
            {session.status === 'paused_for_human' && <div className="negotiation-notice mt-4 flex items-center gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" /><p>{t('live.pausedNotice')}</p></div>}
            {session.status === 'waiting' && <div className="negotiation-notice negotiation-notice--waiting mt-4 flex items-center gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><Clock3 className="h-5 w-5 shrink-0" aria-hidden="true" /><p>{waitingNotice}</p><AriaButton onPress={() => void callAction('time_skip', { waitHours: session.waitingUntilHours ?? 6 })} isDisabled={isBusy || (remainingHours !== null && remainingHours > 0)} className="negotiation-control negotiation-control--small ml-auto min-h-10 rounded-lg bg-white px-3 font-semibold text-amber-900 shadow-sm disabled:opacity-50">{t('live.reassess')}</AriaButton></div>}
            {errorMessage && <div role="alert" className="negotiation-notice negotiation-notice--error mt-4 flex items-start gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />{errorMessage}</div>}
            <div className="sr-only" aria-live="polite">{status.label}</div>
          </section>

          <section className="negotiation-panel box-neo-slant box-neo-slant--surface mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-end justify-between gap-4"><div><p className="eyebrow">{t('live.timelineEyebrow')}</p><h2 className="mt-1 text-xl font-bold text-slate-950">{t('live.timeline')}</h2></div><span className="text-sm text-slate-500">{t('live.actionCount', { count: session.offers.length })}</span></div>
            {session.offers.length === 0 ? <EmptyState /> : <div className="mt-7 space-y-5"><AnimatePresence initial={false}>{session.offers.map((offer, index) => { const isBuyer = offer.senderRole.includes('buyer'); const isWait = offer.actionType === 'wait'; const message = localizeMessage(t, offer.messageTemplate, offer.messageText); const reasoning = localizeReasoning(t, offer.reasoning); return <motion.article key={offer.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="relative flex gap-4"><div className="flex w-8 shrink-0 flex-col items-center"><span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${isBuyer ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'}`}>{isBuyer ? <UserRound className="h-4 w-4" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}</span>{index < session.offers.length - 1 && <span className="mt-1 h-full w-px bg-slate-200" />}</div><div className="negotiation-offer min-w-0 flex-1 rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-sm font-bold text-slate-900">{localizeSenderName(t, offer)}</span><span className="ml-2 text-xs text-slate-400">{t('detail.round', { round: offer.round })} · {offer.timestamp}</span></div><span className={`text-lg font-bold tabular-nums ${isWait ? 'text-amber-700' : 'text-slate-950'}`}>{isWait ? 'WAIT' : formatYen(offer.price)}</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>{offer.terms && <p className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded bg-slate-100 px-2 py-1">{t('offer.quantity', { count: offer.terms.quantity })}</span><span className="rounded bg-slate-100 px-2 py-1">{t('offer.shipping', { price: formatYen(offer.terms.shippingCost) })}</span><span className="rounded bg-slate-100 px-2 py-1">{t('offer.delivery', { days: offer.terms.deliveryDays })}</span><span className="rounded bg-slate-100 px-2 py-1">{offer.terms.taxIncluded ? t('offer.taxIncluded') : t('offer.taxExcluded')} · {offer.terms.paymentTerms}</span></p>}{reasoning && <details className="negotiation-reasoning mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold text-slate-700">{t('live.reasoningToggle')}</summary><p className="mt-2 leading-6 text-slate-600">{reasoning.summary}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-500">{reasoning.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul></details>}</div></motion.article>; })}</AnimatePresence></div>}
          </section>

          {!isFinished && session.status !== 'awaiting_commit' && isMyTurn && <form onSubmit={submitHumanOffer} className="negotiation-panel box-neo-slant box-neo-slant--surface mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex items-start gap-3"><div className="negotiation-form-icon rounded-lg bg-slate-100 p-2 text-slate-700"><Send className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="text-lg font-bold text-slate-950">{t('live.humanTitle')}</h2><p className="mt-1 text-sm text-slate-500">{t('live.humanLead')}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-[160px_1fr_auto]"><label className="field-label">{t('live.price')}<input value={humanPrice} onChange={(event) => setHumanPrice(event.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="23000" className="field-input mt-2" /></label><label className="field-label">{t('live.messageLabel')}<input value={humanMessage} onChange={(event) => setHumanMessage(event.target.value)} maxLength={280} placeholder={t('live.messagePlaceholder')} className="field-input mt-2" /></label><AriaButton type="submit" isDisabled={isBusy} className="primary-button box-neo-slant negotiation-primary-action self-end">{t('live.send')}</AriaButton></div></form>}
        </div>

        <aside className="space-y-6">
          <section className="negotiation-panel box-neo-slant box-neo-slant--mint rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="eyebrow">{t('live.nextActionEyebrow')}</p><h2 className="mt-2 text-lg font-bold text-slate-950">{session.status === 'waiting' ? t('live.nextActionWaiting') : session.status === 'deal' ? t('live.nextActionDeal') : session.status === 'awaiting_commit' ? t('live.nextActionCommit') : session.currentTurn === 'buyer' ? t('live.nextActionBuyer') : t('live.nextActionSeller')}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{session.status === 'waiting' ? t('live.nextBodyWaiting') : session.status === 'deal' ? t('live.nextBodyDeal') : t('live.nextBodyDefault')}</p><div className="negotiation-verification mt-5 flex items-center gap-3 rounded-xl bg-teal-50 p-3 text-sm text-teal-900"><CheckCircle2 className="h-5 w-5 text-teal-700" aria-hidden="true" />{t('live.verifiedNotice')}</div></section>
          <section className="negotiation-panel box-neo-slant box-neo-slant--rose rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="eyebrow">{t('live.estimateEyebrow')}</p><h2 className="mt-2 text-lg font-bold text-slate-950">{t('live.acceptanceScore')}</h2></div><TrendingDown className="h-5 w-5 text-teal-700" aria-hidden="true" /></div><p className="mt-5 text-3xl font-extrabold text-slate-950 tabular-nums">{latestReasoning ? `${latestReasoning.acceptanceScore}%` : t('common.none')}</p><p className="mt-1 text-sm text-slate-500">{t('live.heuristicNote')}</p><div className="negotiation-progress mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: `${latestReasoning?.acceptanceScore ?? 0}%` }} /></div><p className="mt-3 text-xs leading-5 text-slate-500">{t('live.scoreDisclaimer')}</p></section>
          <section className="negotiation-panel box-neo-slant box-neo-slant--surface rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-900">{t('live.transparency')}</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600"><li>{t('live.transparency1')}</li><li>{t('live.transparency2')}</li><li>{t('live.transparency3')}</li></ul></div></div><AriaButton onPress={onGoToDetail} className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800 hover:text-teal-950">{t('live.viewLog')}<ExternalLink className="h-4 w-4" aria-hidden="true" /></AriaButton></section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="negotiation-metric rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p>{hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}</div>;
}

function EmptyState() {
  const { t } = useI18n();
  return <div className="negotiation-empty-state mt-7 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><Clock3 className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" /><p className="mt-3 font-semibold text-slate-800">{t('live.emptyTitle')}</p><p className="mt-1 text-sm text-slate-500">{t('live.emptyBody')}</p></div>;
}
