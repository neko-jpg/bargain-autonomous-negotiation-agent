'use client';

import React, { useEffect } from 'react';
import { DealSummary, Listing } from '@/types/negotiation';
import confetti from 'canvas-confetti';
import { CheckCircle, MessageSquare, Repeat, ShieldCheck, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';

interface DealModalProps {
  summary: DealSummary;
  listing: Listing;
  isOpen: boolean;
  onClose: () => void;
}

export const DealModal: React.FC<DealModalProps> = ({
  summary,
  listing,
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ffe600', '#009d8f', '#ff0055', '#151515'],
      });
    } catch {
      // The modal remains usable when the optional celebration effect is unavailable.
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="deal-modal-backdrop" role="presentation">
      <div
        className="deal-complete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deal-complete-title"
      >
        <button type="button" onClick={onClose} className="deal-complete-modal__close" aria-label="閉じる">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <header className="deal-complete-modal__header">
          <div className="deal-complete-modal__mark">
            <CheckCircle className="h-8 w-8" aria-hidden="true" />
          </div>
          <p className="eyebrow deal-complete-modal__eyebrow">DEAL COMPLETE</p>
          <h2 id="deal-complete-title">交渉が成立しました</h2>
          <p className="deal-complete-modal__lead">合意内容と全アクションを記録しました。</p>
          <p className="deal-complete-modal__price">¥{summary.agreedPrice.toLocaleString()}</p>
          <p className="deal-complete-modal__price-label">合意価格</p>
        </header>

        <div className="deal-complete-modal__body">
          <div className="deal-complete-modal__listing">
            <span>成立した商品</span>
            <strong>{listing.title}</strong>
            <small>出品価格 ¥{summary.initialPrice.toLocaleString()} から合意成立</small>
          </div>

          <div className="deal-complete-modal__metrics">
            <DealMetric
              tone="teal"
              icon={TrendingDown}
              label="買い手の節約"
              value={`¥${summary.buyerSaved.toLocaleString()}`}
              hint={`${summary.buyerSavedPercent}% OFF`}
            />
            <DealMetric
              tone="plum"
              icon={TrendingUp}
              label="売り手の余剰"
              value={`+¥${summary.sellerSurplus.toLocaleString()}`}
              hint="最低価格との差"
            />
            <DealMetric
              tone="yellow"
              icon={Repeat}
              label="アクション"
              value={`${summary.totalActions}回`}
              hint="全イベント"
            />
            <DealMetric
              tone="rose"
              icon={MessageSquare}
              label="人間の介入"
              value={`${summary.humanMessagesCount}回`}
              hint="自動交渉"
            />
          </div>

          <section className="deal-complete-modal__audit" aria-labelledby="deal-audit-title">
            <div className="deal-complete-modal__audit-heading">
              <div>
                <p className="eyebrow">AUTONOMOUS RESULT</p>
                <h3 id="deal-audit-title">エージェント自律交渉の成果</h3>
              </div>
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="deal-complete-modal__audit-row">
              <span><Repeat className="h-4 w-4" aria-hidden="true" />総交渉アクション数</span>
              <strong>{summary.totalActions} actions</strong>
            </div>
            <div className="deal-complete-modal__audit-row">
              <span><MessageSquare className="h-4 w-4" aria-hidden="true" />人間のやり取り回数</span>
              <strong>{summary.humanMessagesCount}回（全自動）</strong>
            </div>
            <div className="deal-complete-modal__audit-row">
              <span><ShieldCheck className="h-4 w-4" aria-hidden="true" />Private Stateガードレール</span>
              <strong>100%遵守</strong>
            </div>
          </section>

          <button type="button" onClick={onClose} className="deal-complete-modal__close-action">
            完了して閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

function DealMetric({
  tone,
  icon: Icon,
  label,
  value,
  hint,
}: {
  tone: 'teal' | 'plum' | 'yellow' | 'rose';
  icon: typeof TrendingDown;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className={`deal-complete-modal__metric deal-complete-modal__metric--${tone}`}>
      <div className="deal-complete-modal__metric-label"><Icon className="h-4 w-4" aria-hidden="true" />{label}</div>
      <strong>{value}</strong>
      <span>{hint}</span>
    </div>
  );
}
