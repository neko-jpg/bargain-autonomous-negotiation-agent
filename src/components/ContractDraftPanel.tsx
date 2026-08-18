'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CheckCircle2, FileCheck2, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import { ContractDraft } from '@/types/negotiation';

export function ContractDraftPanel({ negotiationId }: { negotiationId: string }) {
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/negotiations/${encodeURIComponent(negotiationId)}/contracts`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? '契約ドラフトを読み込めませんでした。');
      setDraft(payload.contracts?.[0] ?? null);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '契約ドラフトを読み込めませんでした。');
    } finally {
      setIsLoading(false);
    }
  }, [negotiationId]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setIsCreating(true);
    try {
      const response = await fetch(`/api/negotiations/${encodeURIComponent(negotiationId)}/contracts`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? '契約ドラフトを作成できませんでした。');
      setDraft(payload.draft as ContractDraft);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '契約ドラフトを作成できませんでした。');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="deal-summary-panel contract-draft-panel" aria-labelledby="contract-draft-title">
      <div className="deal-summary-panel__heading">
        <div>
          <p className="eyebrow">CONTRACT WORKSPACE</p>
          <h2 id="contract-draft-title">契約書ドラフト</h2>
        </div>
        <FileCheck2 className="h-5 w-5 text-teal-800" aria-hidden="true" />
      </div>

      {isLoading ? (
        <p className="contract-draft-panel__state"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />保存状態を確認中…</p>
      ) : draft ? (
        <>
          <div className="contract-draft-panel__status"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /><span>{draft.status === 'approved' ? '承認済み' : draft.status === 'rejected' ? '却下済み' : '承認待ち'}</span><strong>v{draft.version}</strong></div>
          <div className="contract-draft-panel__summary"><span>合意価格</span><strong>¥{draft.agreedPrice.toLocaleString('ja-JP')}</strong><span>想定総額</span><strong>¥{draft.totalAmount.toLocaleString('ja-JP')}</strong></div>
          <p className="contract-draft-panel__note"><LockKeyhole className="h-4 w-4" aria-hidden="true" />重要条件を構造化データから生成した確認用ドラフトです。外部送信・決済は行いません。</p>
          <div className="contract-draft-panel__clauses">{draft.clauses.slice(0, 3).map((clause) => <div key={clause.id}><span>{clause.title}</span><p>{clause.body}</p></div>)}</div>
          <div className="grid gap-2 sm:grid-cols-2"><AriaButton onPress={() => void load()} className="deal-summary-button deal-summary-button--secondary w-full"><RefreshCw className="h-4 w-4" aria-hidden="true" />最新状態を確認</AriaButton>{draft.status === 'rejected' && <AriaButton onPress={() => void create()} isDisabled={isCreating} isPending={isCreating} className="deal-summary-button deal-summary-button--primary w-full">再作成</AriaButton>}</div>
        </>
      ) : (
        <>
          <p className="contract-draft-panel__lead">合意した価格・納期・支払条件から、確認用の契約書ドラフトを作成できます。</p>
          <AriaButton onPress={() => void create()} isDisabled={isCreating} isPending={isCreating} className="deal-summary-button deal-summary-button--primary mt-4 w-full"><FileCheck2 className="h-4 w-4" aria-hidden="true" />{isCreating ? 'ドラフトを作成中…' : '契約ドラフトを作成'}</AriaButton>
        </>
      )}
      {error && <p className="contract-draft-panel__error" role="alert">{error}</p>}
    </section>
  );
}
