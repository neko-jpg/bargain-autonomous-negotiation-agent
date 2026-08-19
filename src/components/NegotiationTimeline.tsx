'use client';

import React from 'react';
import { NegotiationOffer, Listing } from '@/types/negotiation';
import { Bot, User, Clock, CheckCircle2, AlertTriangle, ArrowDownRight, ArrowUpRight, Hourglass, Sparkles } from 'lucide-react';

interface NegotiationTimelineProps {
  offers: NegotiationOffer[];
  listing: Listing;
  currentOfferPrice?: number;
}

export const NegotiationTimeline: React.FC<NegotiationTimelineProps> = ({
  offers,
  listing,
  currentOfferPrice,
}) => {
  if (!offers || offers.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/40">
        <Bot className="w-10 h-10 text-slate-600 mx-auto mb-3 animate-pulse" />
        <h4 className="text-sm font-semibold text-slate-300">交渉待機中</h4>
        <p className="text-xs text-slate-500 mt-1">「交渉を開始」または「1ステップ進める」をクリックして自律交渉を開始します</p>
      </div>
    );
  }

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'make_offer':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">INITIAL OFFER</span>;
      case 'counter_offer':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">COUNTER OFFER</span>;
      case 'wait':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">WAIT 待機</span>;
      case 'accept_offer':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">ACCEPT 合意</span>;
      case 'reject_offer':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">REJECT 終了</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-300">{action}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>Negotiation Timeline & Explainability</span>
        </h4>
        <span className="text-xs text-slate-400 font-mono">
          全 {offers.length} アクション
        </span>
      </div>

      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
        {offers.map((offer, idx) => {
          const isBuyer = offer.senderRole.includes('buyer');
          const isAgent = offer.senderRole.includes('agent');
          const isDeal = offer.actionType === 'accept_offer';
          const isWait = offer.actionType === 'wait';

          return (
            <div
              key={offer.id || idx}
              className={`relative group transition-all duration-300 ${
                isDeal
                  ? 'p-4 rounded-2xl bg-emerald-950/25 border border-emerald-500/40 shadow-lg shadow-emerald-950/30'
                  : isWait
                  ? 'p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30'
                  : 'p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Dot Icon on Timeline */}
              <div
                className={`absolute -left-[30px] top-4 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                  isDeal
                    ? 'bg-emerald-500 border-emerald-300 text-slate-950'
                    : isBuyer
                    ? 'bg-indigo-600 border-slate-900 text-white'
                    : 'bg-purple-600 border-slate-900 text-white'
                }`}
              >
                {isDeal ? <CheckCircle2 className="w-3 h-3" /> : idx + 1}
              </div>

              {/* Header: Sender & Price */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center space-x-2">
                  <div className={`p-1.5 rounded-lg ${isBuyer ? 'bg-indigo-500/20 text-indigo-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    {isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  </div>
                  <div>
                    <span className="font-bold text-sm text-slate-200">{offer.senderName}</span>
                    <span className="text-[11px] text-slate-500 font-mono ml-2">{offer.timestamp}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {getActionBadge(offer.actionType)}
                  <span className={`text-base font-extrabold font-mono ${isDeal ? 'text-emerald-400' : 'text-white'}`}>
                    ¥{offer.price.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Message text */}
              <p className="text-xs text-slate-300 mb-3 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed">
                {offer.messageText}
              </p>

              {offer.terms && (
                <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                  <span className="rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-0.5">数量 {offer.terms.quantity}</span>
                  <span className="rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-0.5">送料 ¥{offer.terms.shippingCost.toLocaleString()}</span>
                  <span className="rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-0.5">納期 {offer.terms.deliveryDays}日</span>
                  <span className="rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-0.5">{offer.terms.taxIncluded ? '税込' : '税別'} · {offer.terms.paymentTerms}</span>
                </div>
              )}

              {/* Explainability Section (Why this offer?) */}
              {offer.reasoning && (
                <div className="mt-2 pt-2.5 border-t border-slate-800/80 text-[11px] space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-semibold text-slate-300 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-indigo-400" />
                      意思決定の根拠 (Reasoning):
                    </span>
                    <span className="font-mono text-indigo-300 font-medium">
                      受諾スコア: {offer.reasoning.acceptanceScore}%
                    </span>
                  </div>

                  <p className="text-slate-300 font-medium bg-indigo-950/30 p-2 rounded-lg border border-indigo-900/40">
                    {offer.reasoning.summary}
                  </p>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {offer.reasoning.factors.map((factor, fIdx) => (
                      <span
                        key={fIdx}
                        className="px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-400 border border-slate-700/50 text-[10px]"
                      >
                        • {factor}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Wait Condition Alert */}
              {isWait && offer.waitTimeHours && (
                <div className="mt-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-center space-x-2">
                  <Hourglass className="w-4 h-4 text-amber-400 animate-spin" />
                  <span>
                    売り手の状況再評価を最大 <strong>{offer.waitTimeHours}時間</strong> 待機中。需要や経過時間に応じた再交渉へ移行します。
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
