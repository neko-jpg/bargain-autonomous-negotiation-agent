'use client';

import { useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Clock3, FileCheck2, MessageSquare, ShieldCheck, TrendingDown, type LucideIcon } from 'lucide-react';
import { ApprovalTask, PublicNegotiationSession } from '@/types/negotiation';

interface DashboardViewProps {
  onSelectNegotiation: (id: string) => void;
  session?: PublicNegotiationSession;
}

export function DashboardView({ onSelectNegotiation, session }: DashboardViewProps) {
  const [analytics, setAnalytics] = useState<{ totalAgentRuns: number; averageLatencyMs: number; fallbackRate: number; averageCandidates: number; guardrailCorrections: number } | null>(null);
  const [workflow, setWorkflow] = useState<{ pendingApprovals: number; totalContracts: number; approvedContracts: number } | null>(null);
  const [approvals, setApprovals] = useState<ApprovalTask[]>([]);
  const [approvalError, setApprovalError] = useState('');

  const loadOperations = async () => {
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
      setApprovalError('運用データを読み込めませんでした。');
    }
  };

  useEffect(() => { void loadOperations(); }, []);

  const resolveApproval = async (task: ApprovalTask, decision: 'approve' | 'reject') => {
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(task.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, expectedVersion: task.version, idempotencyKey: `${task.id}-${task.version}-${decision}` }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? '承認処理に失敗しました。');
      await loadOperations();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : '承認処理に失敗しました。');
    }
  };

  const summary = session?.dealSummary;
  const latestReasoning = [...(session?.offers ?? [])].reverse().find((offer) => offer.reasoning)?.reasoning;
  const statusLabel = session?.status === 'deal' ? '成立' : session?.status === 'waiting' ? '待機中' : session?.status === 'rejected' ? '終了' : '交渉中';
  const statusTone = session?.status === 'deal' ? 'success' : session?.status === 'waiting' ? 'waiting' : session?.status === 'rejected' ? 'ended' : 'active';
  const activityCount = session?.offers.length ?? 0;

  return (
    <div className="dashboard-page page-container py-8 sm:py-10">
      <header className="dashboard-intro">
        <div className="dashboard-intro__copy">
          <p className="eyebrow">BARGAIN REPORT / 01</p>
          <div className="dashboard-intro__title-row">
            <h1>交渉ダッシュボード</h1>
            <span className={`dashboard-status-chip dashboard-status-chip--${statusTone}`}><span />{statusLabel}</span>
          </div>
          <p className="dashboard-intro__description">交渉の状態と成果を、同じイベントログから確認できます。いま見るべき数字だけを、次の一手の近くに置いています。</p>
        </div>
        <div className="dashboard-intro__actions">
          <p className="dashboard-intro__meta">{session ? `Version ${session.version} · ${activityCount}アクション` : 'セッションなし'}</p>
          {session && <AriaButton onPress={() => onSelectNegotiation(session.id)} className="primary-button box-neo-slant dashboard-intro__action"><MessageSquare className="h-4 w-4" aria-hidden="true" />現在の交渉を開く</AriaButton>}
        </div>
      </header>

      <section className="dashboard-overview" aria-label="交渉の概要">
        <article className="dashboard-state-card box-neo-slant" aria-labelledby="dashboard-state-title">
          <div className="dashboard-state-card__top"><p className="eyebrow">SESSION STATUS</p><BarChart3 className="h-6 w-6" aria-hidden="true" /></div>
          <div>
            <p id="dashboard-state-title" className="dashboard-state-card__label">現在の状態</p>
            <p className="dashboard-state-card__value">{statusLabel}</p>
          </div>
          <div className="dashboard-state-card__footer"><span>{session ? `交渉セッション / ${session.id.slice(0, 8)}` : '交渉セッションなし'}</span><span className="dashboard-state-card__pulse"><span />ライブログ</span></div>
        </article>

        <Metric icon={TrendingDown} label="買い手の節約" value={summary ? `¥${summary.buyerSaved.toLocaleString('ja-JP')}` : '—'} hint={summary ? `${summary.buyerSavedPercent}% OFF · 合意価格との差` : '合意後に表示'} tone="surface" className="dashboard-metric--savings" />
        <Metric icon={Clock3} label="アクション" value={`${activityCount}回`} hint="イベントログに記録された判断" tone="mint" className="dashboard-metric--actions" />
        <Metric icon={ShieldCheck} label="受諾スコア" value={latestReasoning ? `${latestReasoning.acceptanceScore}%` : '—'} hint="最新の決定論的評価" tone="rose" className="dashboard-metric--confidence" />
      </section>

      <section className="dashboard-operations" aria-label="AI運用状況">
        <article className="dashboard-operations__metrics box-neo-slant box-neo-slant--mint">
          <div className="dashboard-panel-heading"><div><p className="eyebrow">OPERATIONS / SIGNAL</p><h2>AIエージェントの運用状況</h2></div><BarChart3 className="h-5 w-5" aria-hidden="true" /></div>
          <div className="dashboard-operations__grid">
            <OpsMetric label="実行回数" value={analytics ? `${analytics.totalAgentRuns}回` : '—'} hint="直近のエージェント実行" />
            <OpsMetric label="候補比較" value={analytics ? `${analytics.averageCandidates}件` : '—'} hint="1回あたりの平均" />
            <OpsMetric label="平均応答" value={analytics ? `${analytics.averageLatencyMs}ms` : '—'} hint="LLM + ガードレール" />
            <OpsMetric label="補正回数" value={analytics ? `${analytics.guardrailCorrections}回` : '—'} hint="制約により除外・補正" />
          </div>
          <p className="dashboard-operations__footnote">フォールバック率 {analytics ? `${analytics.fallbackRate}%` : '—'} · 契約ドラフト {workflow ? `${workflow.totalContracts}件` : '—'} · 承認待ち {workflow ? `${workflow.pendingApprovals}件` : '—'}</p>
        </article>

        <aside className="dashboard-approval-panel box-neo-slant box-neo-slant--rose" aria-labelledby="approval-queue-title">
          <div className="dashboard-panel-heading"><div><p className="eyebrow">HUMAN GATE</p><h2 id="approval-queue-title">承認キュー</h2></div><span className="dashboard-activity-count">{approvals.length}件</span></div>
          {approvals.length === 0 ? <p className="dashboard-approval-empty"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />現在、確認待ちの操作はありません。</p> : <div className="dashboard-approval-list">{approvals.slice(0, 4).map((task) => <div key={task.id} className="dashboard-approval-item"><div><span className="dashboard-approval-item__kind">{task.kind === 'contract' ? <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> : <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}{task.kind === 'contract' ? '契約ドラフト' : '返信案'}</span><p>{task.title}</p><small>{new Date(task.createdAt).toLocaleString('ja-JP')}</small></div><div className="dashboard-approval-item__actions"><AriaButton onPress={() => void resolveApproval(task, 'reject')} className="dashboard-approval-button dashboard-approval-button--reject">却下</AriaButton><AriaButton onPress={() => void resolveApproval(task, 'approve')} className="dashboard-approval-button dashboard-approval-button--approve">承認</AriaButton></div></div>)}</div>}
          {approvalError && <p className="dashboard-approval-error" role="alert"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{approvalError}</p>}
        </aside>
      </section>

      <div className="dashboard-lower">
        <section className="dashboard-activity-panel box-neo-slant box-neo-slant--surface" aria-labelledby="dashboard-activity-title">
          <div className="dashboard-panel-heading"><div><p className="eyebrow">ACTIVITY / STREAM</p><h2 id="dashboard-activity-title">最近のアクティビティ</h2></div><span className="dashboard-activity-count">{activityCount}件</span></div>
          {activityCount ? <div className="dashboard-activity-list">{session?.offers.slice().reverse().map((offer, index) => <div key={offer.id} className="dashboard-activity-item"><span className="dashboard-activity-item__index">{String(index + 1).padStart(2, '0')}</span><span className="dashboard-activity-item__marker" aria-hidden="true" /><div className="dashboard-activity-item__copy"><p>{offer.senderName}</p><span>{offer.messageText}</span></div><strong>{offer.actionType === 'wait' ? 'WAIT' : `¥${offer.price.toLocaleString('ja-JP')}`}</strong></div>)}</div> : <div className="dashboard-activity-empty"><span className="dashboard-activity-empty__index">00</span><div><p>まだアクティビティがありません</p><span>商品ページから交渉を開始すると、提案と判断理由がここに並びます。</span></div><ArrowRight className="dashboard-activity-empty__arrow" aria-hidden="true" /></div>}
        </section>

        <aside className="dashboard-reading-panel box-neo-slant box-neo-slant--ink" aria-labelledby="dashboard-reading-title">
          <div><p className="eyebrow">READ THE SIGNAL</p><h2 id="dashboard-reading-title">数字は、次の一手を見るために。</h2><p className="dashboard-reading-panel__lead">BARGAINは結果だけでなく、交渉の途中で何が起きたかを残します。</p></div>
          <dl className="dashboard-reading-list"><div><dt>取引率</dt><dd>合意に至ったセッションの割合</dd></div><div><dt>買い手余剰</dt><dd>初期価格と合意価格の差</dd></div><div><dt>介入率</dt><dd>人間が送信したアクションの割合</dd></div></dl>
          <AriaButton onPress={() => session && onSelectNegotiation(session.id)} isDisabled={!session} className="dashboard-reading-link">ログを詳しく見る<ArrowRight className="h-4 w-4" aria-hidden="true" /></AriaButton>
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
