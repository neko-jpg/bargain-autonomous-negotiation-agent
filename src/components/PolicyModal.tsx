'use client';

import React, { useState } from 'react';
import { Listing, BuyerPolicy, DelegationLevel } from '@/types/negotiation';
import { X, ShieldAlert, Sparkles, Sliders, CheckCircle2, Lock, ArrowRight, HelpCircle } from 'lucide-react';

interface PolicyModalProps {
  listing: Listing;
  isOpen: boolean;
  onClose: () => void;
  onStartNegotiation: (policy: BuyerPolicy) => void;
}

export const PolicyModal: React.FC<PolicyModalProps> = ({
  listing,
  isOpen,
  onClose,
  onStartNegotiation,
}) => {
  const defaultTarget = Math.round(listing.price * 0.85);
  const defaultMax = Math.round(listing.price * 0.94);

  const [targetPrice, setTargetPrice] = useState<number>(defaultTarget);
  const [maxPrice, setMaxPrice] = useState<number>(defaultMax);
  const [deadlineDays, setDeadlineDays] = useState<number>(3);
  const [delegationLevel, setDelegationLevel] = useState<DelegationLevel>(3);
  const [autoPurchase, setAutoPurchase] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStartNegotiation({
      targetPrice,
      maxPrice,
      deadlineDays,
      autoPurchase,
      delegationLevel,
    });
  };

  const discountFromListing = Math.round(((listing.price - targetPrice) / listing.price) * 100);
  const maxSavings = listing.price - targetPrice;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="relative p-6 border-b border-slate-800 bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  AIに価格交渉を任せる
                  <span className="text-[10px] bg-indigo-500/25 text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                    権限委任ポリシー
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  {listing.title.slice(0, 36)}...
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Target Price */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span>希望目標価格</span>
                <span className="text-xs text-slate-400 font-normal">(AIが最初に狙う価格)</span>
              </label>
              <span className="text-indigo-400 font-bold text-base">
                ¥{targetPrice.toLocaleString()}
                <span className="text-xs text-slate-400 font-normal ml-1.5">(-{discountFromListing}%)</span>
              </span>
            </div>
            <input
              type="range"
              min={Math.round(listing.price * 0.6)}
              max={listing.price}
              step={100}
              value={targetPrice}
              onChange={(e) => {
                const val = Number(e.target.value);
                setTargetPrice(val);
                if (val > maxPrice) setMaxPrice(val);
              }}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>¥{Math.round(listing.price * 0.6).toLocaleString()}</span>
              <span>現在価格: ¥{listing.price.toLocaleString()}</span>
            </div>
          </div>

          {/* Max Price (Private State) */}
          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-2">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-amber-200 text-sm flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>最高許容価格 (Private State)</span>
              </label>
              <span className="text-amber-300 font-bold text-base">
                ¥{maxPrice.toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-amber-300/80">
              ※この金額は相手売り手や相手AIには<strong className="text-amber-200">絶対に開示されません</strong>。AIはこの上限を超えた提示を一切行いません。
            </p>
            <input
              type="range"
              min={targetPrice}
              max={listing.price}
              step={100}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="w-full h-2 bg-amber-950/40 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          {/* Delegation Levels */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-200 flex items-center justify-between">
              <span>自律性の委任レベル (Human-in-the-loop)</span>
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                {
                  level: 1 as DelegationLevel,
                  title: 'Level 1: 提案のみ',
                  desc: 'AIが提示案を作成、毎回ユーザーが承認',
                },
                {
                  level: 2 as DelegationLevel,
                  title: 'Level 2: 交渉代行',
                  desc: '上限内でAIが交渉、最終購入時に確認',
                },
                {
                  level: 3 as DelegationLevel,
                  title: 'Level 3: 完全委任',
                  desc: '条件合致時に自動購入まで実行',
                },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.level}
                  onClick={() => {
                    setDelegationLevel(opt.level);
                    setAutoPurchase(opt.level === 3);
                  }}
                  className={`p-3 rounded-xl text-left border transition-all ${
                    delegationLevel === opt.level
                      ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                      : 'bg-slate-800/50 border-slate-750 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-xs flex items-center justify-between mb-1">
                    <span>{opt.title}</span>
                    {delegationLevel === opt.level && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Options: Deadline & Auto Purchase */}
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                交渉期限
              </label>
              <select
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={1}>1日 (即決優先)</option>
                <option value={3}>3日 (おすすめ)</option>
                <option value={7}>7日 (じっくり値下がり待ち)</option>
                <option value={14}>14日 (最大粘り)</option>
              </select>
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPurchase}
                  onChange={(e) => setAutoPurchase(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 accent-indigo-500"
                />
                <span className="text-xs text-slate-300 font-medium">
                  上限以内で合意時に自動購入
                </span>
              </label>
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-3">
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/25 flex items-center justify-center space-x-2 transition-all transform active:scale-[0.99]"
            >
              <span>BARGAIN Agentに交渉を任せる</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
