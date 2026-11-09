'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Clock3, FileCheck2, MessageSquare, ShieldCheck, TrendingDown, type LucideIcon } from 'lucide-react';
import { ApprovalTask, PublicNegotiationSession } from '@/types/negotiation';
import { localizeMessage, localizeSenderName } from '@/lib/i18n/content';
import { statusLabelKey } from '@/lib/i18n/labels';
import { approvalTitleKey } from '@/lib/i18n/termValues';
import { useI18n } from '@/lib/i18n/provider';

interface DashboardViewProps {
  onSelectNegotiation: (id: string) => void;
  session?: PublicNegotiationSession;
}

export function DashboardView({ onSelectNegotiation, session }: DashboardViewProps) {
  const { t, formatYen, formatDateTime } = useI18n();
  const [analytics, setAnalytics] = useState<{ totalAgentRuns: number; averageLatencyMs: number; fallbackRate: number; averageCandidates: number; guardrailCorrections: number } | null>(null);
  const [workflow, setWorkflow] = useState<{ pendingApprovals: number; totalContracts: number; approvedContracts: number } | null>(null);
  const [approvals, setApprovals] = useState<ApprovalTask[]>([]);
  const [approvalError, setApprovalError] = useState('');

  const loadOperations = useCallback(async () => {
    try {
      const [analyticsResponse, approvalResponse] = await Promise.all([
        fetch('/api/analytics', { cache: 'no-store' }),
        fetch('/api/approvals?status=pending', { cache: 'no-store' }),
      ]);
      const analyticsPayload = await analyticsResponse.json();
      const approvalPayload = await approvalResponse.json();
      if (analyticsResponse.ok) {
        setAnalytics(analyticsPayload.analytics);
        setWorkflow(analyticsPayload.workflow);
      }
      if (approvalResponse.ok) setApprovals(approvalPayload.tasks ?? []);
    } catch {
      setApprovalError(t('dashboard.errorLoad'));
    }
  }, [t]);

  useEffect(() => { void loadOperations(); }, [loadOperations]);

  const resolveApproval = async (task: ApprovalTask, decision: 'approve' | 'reject') => {
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(task.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, expectedVersion: task.version, idempotencyKey: `${task.id}-${task.version}-${decision}` }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? t('dashboard.errorApproval'));
      await loadOperations();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : t('dashboard.errorApproval'));
    }
  };

  const summary = session?.dealSummary;
  const latestReasoning = [...(session?.offers ?? [])].reverse().find((offer) => offer.reasoning)?.reasoning;
  const statusLabel = t(statusLabelKey(session?.status) ?? 'enum.status.active');
  const statusTone = session?.status === 'deal' ? 'success' : session?.status === 'waiting' ? 'waiting' : session?.status === 'rejected' ? 'ended' : 'active';
  const activityCount = session?.offers.length ?? 0;

  return (
    <div className="dashboard-page page-container py-8 sm:py-10">
      <header className="dashboard-intro">
        <div className="dashboard-intro__copy">
          <p className="eyebrow">{t('dashboard.eyebrow')}</p>
          <div className="dashboard-intro__title-row">
            <h1>{t('dashboard.title')}</h1>
            <span className={`dashboard-status-chip dashboard-status-chip--${statusTone}`}><span />{statusLabel}</span>
          </div>
          <p className="dashboard-intro__description">{t('dashboard.description')}</p>
        </div>
        <div className="dashboard-intro__actions">
          <p className="dashboard-intro__meta">{session ? t('dashboard.meta', { version: session.version, count: activityCount }) : t('dashboard.noSession')}</p>
          {session && <AriaButton onPress={() => onSelectNegotiation(session.id)} className="primary-button box-neo-slant dashboard-intro__action"><MessageSquare className="h-4 w-4" aria-hidden="true" />{t('dashboard.openCurrent')}</AriaButton>}
        </div>
      </header>

      <section className="dashboard-overview" aria-label={t('dashboard.overviewAria')}>
        <article className="dashboard-state-card box-neo-slant" aria-labelledby="dashboard-state-title">
          <div className="dashboard-state-card__top"><p className="eyebrow">{t('dashboard.sessionStatus')}</p><BarChart3 className="h-6 w-6" aria-hidden="true" /></div>
          <div>
            <p id="dashboard-state-title" className="dashboard-state-card__label">{t('dashboard.currentState')}</p>
            <p className="dashboard-state-card__value">{statusLabel}</p>
          </div>
          <div className="dashboard-state-card__footer"><span>{session ? t('dashboard.sessionId', { id: session.id.slice(0, 8) }) : t('dashboard.noSessionId')}</span><span className="dashboard-state-card__pulse"><span />{t('dashboard.liveLog')}</span></div>
        </article>

        <Metric icon={TrendingDown} label={t('dashboard.buyerSavings')} value={summary ? formatYen(summary.buyerSaved) : t('common.none')} hint={summary ? t('dashboard.savingsHint', { percent: summary.buyerSavedPercent }) : t('dashboard.afterAgreement')} tone="surface" className="dashboard-metric--savings" />
        <Metric icon={Clock3} label={t('dashboard.actions')} value={t('dashboard.count', { count: activityCount })} hint={t('dashboard.actionsHint')} tone="mint" className="dashboard-metric--actions" />
        <Metric icon={ShieldCheck} label={t('dashboard.acceptanceScore')} value={latestReasoning ? `${latestReasoning.acceptanceScore}%` : t('common.none')} hint={t('dashboard.scoreHint')} tone="rose" className="dashboard-metric--confidence" />
      </section>

      <section className="dashboard-operations" aria-label={t('dashboard.opsAria')}>
        <article className="dashboard-operations__metrics box-neo-slant box-neo-slant--mint">
          <div className="dashboard-panel-heading"><div><p className="eyebrow">{t('dashboard.opsEyebrow')}</p><h2>{t('dashboard.opsTitle')}</h2></div><BarChart3 className="h-5 w-5" aria-hidden="true" /></div>
          <div className="dashboard-operations__grid">
            <OpsMetric label={t('dashboard.runs')} value={analytics ? t('dashboard.count', { count: analytics.totalAgentRuns }) : t('common.none')} hint={t('dashboard.runsHint')} />
            <OpsMetric label={t('dashboard.candidates')} value={analytics ? t('dashboard.count', { count: analytics.averageCandidates }) : t('common.none')} hint={t('dashboard.candidatesHint')} />
            <OpsMetric label={t('dashboard.latency')} value={analytics ? `${analytics.averageLatencyMs}ms` : t('common.none')} hint={t('dashboard.latencyHint')} />
            <OpsMetric label={t('dashboard.corrections')} value={analytics ? t('dashboard.count', { count: analytics.guardrailCorrections }) : t('common.none')} hint={t('dashboard.correctionsHint')} />
          </div>
          <p className="dashboard-operations__footnote">{t('dashboard.footnote', {
            rate: analytics ? `${analytics.fallbackRate}%` : t('common.none'),
            contracts: workflow ? t('dashboard.count', { count: workflow.totalContracts }) : t('common.none'),
            pending: workflow ? t('dashboard.count', { count: workflow.pendingApprovals }) : t('common.none'),
          })}</p>
        </article>

        <aside className="dashboard-approval-panel box-neo-slant box-neo-slant--rose" aria-labelledby="approval-queue-title">
          <div className="dashboard-panel-heading"><div><p className="eyebrow">{t('dashboard.approvalEyebrow')}</p><h2 id="approval-queue-title">{t('dashboard.approvalQueue')}</h2></div><span className="dashboard-activity-count">{t('dashboard.count', { count: approvals.length })}</span></div>
          {approvals.length === 0 ? <p className="dashboard-approval-empty"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{t('dashboard.approvalEmpty')}</p> : <div className="dashboard-approval-list">{approvals.slice(0, 4).map((task) => <div key={task.id} className="dashboard-approval-item"><div><span className="dashboard-approval-item__kind">{task.kind === 'contract' ? <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> : <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}{task.kind === 'contract' ? t('dashboard.kindContract') : task.kind === 'commit' ? t('dashboard.kindCommit') : t('dashboard.kindReply')}</span><p>{(() => { const key = approvalTitleKey(task.title); return key ? t(key) : task.title; })()}</p><small>{formatDateTime(task.createdAt)}</small></div><div className="dashboard-approval-item__actions"><AriaButton onPress={() => void resolveApproval(task, 'reject')} className="dashboard-approval-button dashboard-approval-button--reject">{t('dashboard.reject')}</AriaButton><AriaButton onPress={() => void resolveApproval(task, 'approve')} className="dashboard-approval-button dashboard-approval-button--approve">{t('dashboard.approve')}</AriaButton></div></div>)}</div>}
          {approvalError && <p className="dashboard-approval-error" role="alert"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{approvalError}</p>}
        </aside>
      </section>

      <div className="dashboard-lower">
        <section className="dashboard-activity-panel box-neo-slant box-neo-slant--surface" aria-labelledby="dashboard-activity-title">
          <div className="dashboard-panel-heading"><div><p className="eyebrow">{t('dashboard.activityEyebrow')}</p><h2 id="dashboard-activity-title">{t('dashboard.activity')}</h2></div><span className="dashboard-activity-count">{t('dashboard.count', { count: activityCount })}</span></div>
          {activityCount ? <div className="dashboard-activity-list">{session?.offers.slice().reverse().map((offer, index) => <div key={offer.id} className="dashboard-activity-item"><span className="dashboard-activity-item__index">{String(index + 1).padStart(2, '0')}</span><span className="dashboard-activity-item__marker" aria-hidden="true" /><div className="dashboard-activity-item__copy"><p>{localizeSenderName(t, offer)}</p><span>{localizeMessage(t, offer.messageTemplate, offer.messageText)}</span></div><strong>{offer.actionType === 'wait' ? 'WAIT' : formatYen(offer.price)}</strong></div>)}</div> : <div className="dashboard-activity-empty"><span className="dashboard-activity-empty__index">00</span><div><p>{t('dashboard.emptyActivityTitle')}</p><span>{t('dashboard.emptyActivityBody')}</span></div><ArrowRight className="dashboard-activity-empty__arrow" aria-hidden="true" /></div>}
        </section>

        <aside className="dashboard-reading-panel box-neo-slant box-neo-slant--ink" aria-labelledby="dashboard-reading-title">
          <div><p className="eyebrow">{t('dashboard.readEyebrow')}</p><h2 id="dashboard-reading-title">{t('dashboard.readTitle')}</h2><p className="dashboard-reading-panel__lead">{t('dashboard.readLead')}</p></div>
          <dl className="dashboard-reading-list"><div><dt>{t('dashboard.dealRate')}</dt><dd>{t('dashboard.dealRateBody')}</dd></div><div><dt>{t('dashboard.buyerSurplus')}</dt><dd>{t('dashboard.buyerSurplusBody')}</dd></div><div><dt>{t('dashboard.interventionRate')}</dt><dd>{t('dashboard.interventionBody')}</dd></div></dl>
          <AriaButton onPress={() => session && onSelectNegotiation(session.id)} isDisabled={!session} className="dashboard-reading-link">{t('dashboard.viewLog')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>
        </aside>
      </div>
    </div>
  );
}

function OpsMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="dashboard-operations__metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function Metric({ icon: Icon, label, value, hint, tone, className = '' }: { icon: LucideIcon; label: string; value: string; hint: string; tone: 'surface' | 'mint' | 'rose'; className?: string }) {
  return <article className={`dashboard-metric dashboard-metric--${tone} box-neo-slant box-neo-slant--${tone} ${className}`}><div className="dashboard-metric__top"><p>{label}</p><span className="dashboard-metric__icon"><Icon className="h-4 w-4" aria-hidden="true" /></span></div><strong>{value}</strong><small>{hint}</small></article>;
}
