'use client';

import React from 'react';
import { BarChart3, TrendingUp, Sparkles, CheckCircle2, ShieldCheck, DollarSign, Clock, Users, ArrowUpRight } from 'lucide-react';

export const KPIDashboard: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fade-in">
      {/* Title */}
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-2">
        <div className="flex items-center space-x-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
          <BarChart3 className="w-4 h-4" />
          <span>Project BARGAIN KPI Analytics</span>
        </div>
        <h2 className="text-3xl font-black text-white">エージェント評価・市場実験ダッシュボード</h2>
        <p className="text-sm text-slate-400 max-w-3xl">
          単なるLLMの回答品質ではなく、実際のC2C取引結果（取引成立率・ユーザー余剰・摩擦削減効果）を定量評価します。
        </p>
      </div>

      {/* Primary KPI Cards (企画書18. 重要KPI) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Transaction Rate */}
        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
            <span>取引成立率 (Deal Rate)</span>
            <span className="p-1 rounded-lg bg-emerald-500/20 text-emerald-300">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="text-3xl font-black font-mono text-white">78.4%</div>
          <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Negotiation Lift +31.2%</span>
          </div>
        </div>

        {/* KPI 2: Buyer Surplus */}
        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
            <span>平均 買い手節約額 (Surplus)</span>
            <span className="p-1 rounded-lg bg-indigo-500/20 text-indigo-300">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="text-3xl font-black font-mono text-indigo-400">¥3,420</div>
          <div className="text-[11px] text-slate-400 font-mono">
            出品価格比 -12.8% 節約
          </div>
        </div>

        {/* KPI 3: Time to Deal */}
        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
            <span>合意成立時間 (Time to Deal)</span>
            <span className="p-1 rounded-lg bg-purple-500/20 text-purple-300">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="text-3xl font-black font-mono text-purple-400">4.2 rounds</div>
          <div className="text-[11px] text-purple-300 font-semibold">
            数時間 → 数分・自動処理
          </div>
        </div>

        {/* KPI 4: Human Intervention Rate */}
        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
            <span>人間介入率 (Intervention Rate)</span>
            <span className="p-1 rounded-lg bg-amber-500/20 text-amber-300">
              <Users className="w-4 h-4" />
            </span>
          </div>
          <div className="text-3xl font-black font-mono text-amber-400">6.8%</div>
          <div className="text-[11px] text-slate-400">
            93.2% の取引が完全自律で成立
          </div>
        </div>
      </div>

      {/* Experiment Simulation: Control vs Treatment A vs Treatment B (企画書19. 実験) */}
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-6">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <span>Sandbox市場実験 (1,000 Listings Simulation)</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            AIなし (Control) vs 単純値下げBot (Treatment A) vs Project BARGAIN (Treatment B) の比較検証
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold">
                <th className="pb-3 px-3">実験グループ</th>
                <th className="pb-3 px-3">取引成立率 (Deal Rate)</th>
                <th className="pb-3 px-3">総流通取引額 (GMV)</th>
                <th className="pb-3 px-3">買い手余剰 (Buyer Surplus)</th>
                <th className="pb-3 px-3">売り手余剰 (Seller Surplus)</th>
                <th className="pb-3 px-3">人間メッセージ往復数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              <tr className="text-slate-400">
                <td className="py-3 px-3 font-sans font-bold text-slate-300">Control (AIなし・手動)</td>
                <td className="py-3 px-3">47.2%</td>
                <td className="py-3 px-3">¥11,800,000</td>
                <td className="py-3 px-3">¥820,000</td>
                <td className="py-3 px-3">¥450,000</td>
                <td className="py-3 px-3 text-red-400">6.4 回 / 件</td>
              </tr>
              <tr className="text-slate-400">
                <td className="py-3 px-3 font-sans font-bold text-slate-300">Treatment A (単純値下げBot)</td>
                <td className="py-3 px-3">61.5%</td>
                <td className="py-3 px-3">¥13,200,000</td>
                <td className="py-3 px-3">¥1,450,000</td>
                <td className="py-3 px-3 text-amber-400">¥120,000 (売り手利益減少)</td>
                <td className="py-3 px-3">2.1 回 / 件</td>
              </tr>
              <tr className="bg-indigo-950/25 font-bold text-white">
                <td className="py-3.5 px-3 font-sans flex items-center gap-1.5 text-indigo-300">
                  <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                  <span>Treatment B (Project BARGAIN)</span>
                </td>
                <td className="py-3.5 px-3 text-emerald-400 text-sm font-black">78.4% (+31.2% Lift)</td>
                <td className="py-3.5 px-3 text-indigo-300">¥18,650,000</td>
                <td className="py-3.5 px-3 text-indigo-300">¥2,340,000</td>
                <td className="py-3.5 px-3 text-purple-300">+¥980,000 (双方余剰最大化)</td>
                <td className="py-3.5 px-3 text-emerald-400 text-sm font-black">0.2 回 / 件</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
