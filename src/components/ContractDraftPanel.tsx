'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CheckCircle2, FileCheck2, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import { ContractDraft } from '@/types/negotiation';
import { useI18n } from '@/lib/i18n/provider';

export function ContractDraftPanel({ negotiationId }: { negotiationId: string }) {
  const { t, formatYen } = useI18n();
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/negotiations/${encodeURIComponent(negotiationId)}/contracts`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? t('contract.loadFailed'));
      setDraft(payload.contracts?.[0] ?? null);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('contract.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [negotiationId, t]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setIsCreating(true);
    try {
      const response = await fetch(`/api/negotiations/${encodeURIComponent(negotiationId)}/contracts`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? t('contract.createFailed'));
      setDraft(payload.draft as ContractDraft);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('contract.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const statusLabel = draft?.status === 'approved'
    ? t('contract.statusApproved')
    : draft?.status === 'rejected'
      ? t('contract.statusRejected')
      : t('contract.statusPending');

  return (
    <section className="deal-summary-panel contract-draft-panel" aria-labelledby="contract-draft-title">
      <div className="deal-summary-panel__heading">
        <div>
          <p className="eyebrow">{t('contract.eyebrow')}</p>
          <h2 id="contract-draft-title">{t('contract.title')}</h2>
        </div>
        <FileCheck2 className="h-5 w-5 text-teal-800" aria-hidden="true" />
      </div>

      {isLoading ? (
        <p className="contract-draft-panel__state"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('contract.checking')}</p>
      ) : draft ? (
        <>
          <div className="contract-draft-panel__status"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /><span>{statusLabel}</span><strong>v{draft.version}</strong></div>
          <div className="contract-draft-panel__summary"><span>{t('contract.agreedPrice')}</span><strong>{formatYen(draft.agreedPrice)}</strong><span>{t('contract.total')}</span><strong>{formatYen(draft.totalAmount)}</strong></div>
          <p className="contract-draft-panel__note"><LockKeyhole className="h-4 w-4" aria-hidden="true" />{t('contract.note')}</p>
          <div className="contract-draft-panel__clauses">{draft.clauses.slice(0, 3).map((clause) => <div key={clause.id}><span>{clause.titleKey ? t(clause.titleKey, clause.params) : clause.title}</span><p>{clause.bodyKey ? t(clause.bodyKey, clause.params) : clause.body}</p></div>)}</div>
          <div className="grid gap-2 sm:grid-cols-2"><AriaButton onPress={() => void load()} className="deal-summary-button deal-summary-button--secondary w-full"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('contract.refresh')}</AriaButton>{draft.status === 'rejected' && <AriaButton onPress={() => void create()} isDisabled={isCreating} isPending={isCreating} className="deal-summary-button deal-summary-button--primary w-full">{t('contract.recreate')}</AriaButton>}</div>
        </>
      ) : (
        <>
          <p className="contract-draft-panel__lead">{t('contract.lead')}</p>
          <AriaButton onPress={() => void create()} isDisabled={isCreating} isPending={isCreating} className="deal-summary-button deal-summary-button--primary mt-4 w-full"><FileCheck2 className="h-4 w-4" aria-hidden="true" />{isCreating ? t('contract.creating') : t('contract.create')}</AriaButton>
        </>
      )}
      {error && <p className="contract-draft-panel__error" role="alert">{error}</p>}
    </section>
  );
}
