'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { NegotiationSession, Listing, BuyerPolicy, SellerPolicy } from '@/types/negotiation';
import { INITIAL_LISTINGS } from '@/lib/mockData';
import { NegotiationLiveView } from './NegotiationLiveView';
import { PlayCircle, User, Bot, Sliders, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

interface SandboxViewProps {
  onStartCustomSession: (session: NegotiationSession) => void;
}

export const SandboxView: React.FC<SandboxViewProps> = ({ onStartCustomSession }) => {
  const [mode, setMode] = useState<'agent_vs_agent' | 'human_vs_agent_buyer' | 'human_vs_agent_seller'>('agent_vs_agent');
  const [selectedListing, setSelectedListing] = useState<Listing>(INITIAL_LISTINGS[1]); // iPhone 15 Pro
  
  // Buyer params
  const [buyerTarget, setBuyerTarget] = useState<number>(102000);
  const [buyerMax, setBuyerMax] = useState<number>(110000);
  const [buyerPatience, setBuyerPatience] = useState<number>(0.7);

  // Seller params
  const [sellerTarget, setSellerTarget] = useState<number>(115000);
  const [sellerMin, setSellerMin] = useState<number>(108000);
  const [sellerUrgency, setSellerUrgency] = useState<'low' | 'medium' | 'high'>('medium');

  const handleStart = () => {
    const session: NegotiationSession = {
      id: `sandbox-${Date.now()}`,
      buyerId: 'buyer-local',
      sellerId: `seller:${selectedListing.sellerName}`,
      listing: { ...selectedListing },
      buyerPolicy: {
        targetPrice: buyerTarget,
        maxPrice: buyerMax,
        deadlineDays: 3,
        autoPurchase: true,
        delegationLevel: 3,
      },
      sellerPolicy: {
        targetPrice: sellerTarget,
        minPrice: sellerMin,
        urgency: sellerUrgency,
        deadlineDays: 7,
        autoAccept: true,
      },
      buyerPrivateState: {
        reservationPrice: buyerMax,
        riskTolerance: 0.5,
        patienceScore: buyerPatience,
        batna: Math.round(selectedListing.marketMedianPrice * 0.98),
      },
      sellerPrivateState: {
        reservationPrice: sellerMin,
        riskTolerance: 0.5,
        patienceScore: sellerUrgency === 'high' ? 0.3 : 0.6,
        batna: Math.round(selectedListing.marketMedianPrice * 0.94),
      },
      offers: [],
      currentTurn: mode === 'human_vs_agent_buyer' ? 'buyer' : 'buyer',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onStartCustomSession(session);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fade-in">
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <PlayCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">交渉サンドボックス (Simulation Arena)</h2>
            <p className="text-xs text-slate-400">エージェント対戦、パラメータチューニング、人間 vs AIのリアルタイム交渉</p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {[
            {
              id: 'agent_vs_agent',
              title: 'Agent vs Agent',
              desc: '買い手AI vs 売り手AIの完全自律対決',
              icon: Bot,
            },
            {
              id: 'human_vs_agent_buyer',
              title: 'Human vs AI (Buyer)',
              desc: 'あなたが買い手として売り手AIと交渉',
              icon: User,
            },
            {
              id: 'human_vs_agent_seller',
              title: 'Human vs AI (Seller)',
              desc: 'あなたが出品者として買い手AIと交渉',
              icon: User,
            },
          ].map((m) => {
            const Icon = m.icon;
            const isSelected = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id as any)}
                className={`p-4 rounded-2xl text-left border transition-all ${
                  isSelected
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-600/10'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-2 font-bold text-sm mb-1 text-slate-200">
                  <Icon className="w-4 h-4 text-indigo-400" />
                  <span>{m.title}</span>
                </div>
                <p className="text-xs text-slate-400">{m.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Listing Selector */}
        <div className="space-y-2 pt-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            対象商品を選択
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {INITIAL_LISTINGS.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setSelectedListing(l);
                  setBuyerTarget(Math.round(l.price * 0.85));
                  setBuyerMax(Math.round(l.price * 0.94));
                  setSellerTarget(Math.round(l.price * 0.97));
                  setSellerMin(Math.round(l.price * 0.90));
                }}
                className={`p-2.5 rounded-2xl text-left border transition-all ${
                  selectedListing.id === l.id
                    ? 'bg-indigo-600/25 border-indigo-500 text-white ring-1 ring-indigo-500/50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Image src={l.imageUrl} alt={l.title} width={320} height={64} className="w-full h-16 object-cover rounded-xl mb-1.5" />
                <div className="text-xs font-bold line-clamp-1">{l.title}</div>
                <div className="text-xs font-mono text-indigo-400 font-bold">¥{l.price.toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Parameters Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
          {/* Buyer Config */}
          <div className="p-5 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 space-y-4">
            <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-1.5">
              <Bot className="w-4 h-4" />
              <span>買い手側 パラメータ設定</span>
            </h3>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>目標価格 (Target):</span>
                  <span className="font-mono font-bold text-indigo-300">¥{buyerTarget.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={Math.round(selectedListing.price * 0.6)}
                  max={selectedListing.price}
                  step={500}
                  value={buyerTarget}
                  onChange={(e) => setBuyerTarget(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-amber-300 mb-1">
                  <span>上限価格 (Private Max):</span>
                  <span className="font-mono font-bold">¥{buyerMax.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={buyerTarget}
                  max={selectedListing.price}
                  step={500}
                  value={buyerMax}
                  onChange={(e) => setBuyerMax(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg accent-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Seller Config */}
          <div className="p-5 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-4">
            <h3 className="text-sm font-bold text-purple-300 flex items-center gap-1.5">
              <Bot className="w-4 h-4" />
              <span>売り手側 パラメータ設定</span>
            </h3>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>希望価格 (Target):</span>
                  <span className="font-mono font-bold text-purple-300">¥{sellerTarget.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={Math.round(selectedListing.price * 0.7)}
                  max={selectedListing.price}
                  step={500}
                  value={sellerTarget}
                  onChange={(e) => setSellerTarget(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg accent-purple-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-amber-300 mb-1">
                  <span>最低価格 (Private Min):</span>
                  <span className="font-mono font-bold">¥{sellerMin.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={Math.round(selectedListing.price * 0.6)}
                  max={sellerTarget}
                  step={500}
                  value={sellerMin}
                  onChange={(e) => setSellerMin(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg accent-amber-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">売却急ぎ度 (Urgency):</label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(['low', 'medium', 'high'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setSellerUrgency(u)}
                      className={`py-1 rounded-lg border font-medium ${
                        sellerUrgency === u
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-slate-900 text-slate-400 border-slate-700'
                      }`}
                    >
                      {u === 'low' ? '低 (強気)' : u === 'medium' ? '中 (標準)' : '高 (急ぎ)'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Start Button */}
        <div className="pt-2">
          <button
            onClick={handleStart}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold shadow-xl shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all transform active:scale-[0.99]"
          >
            <span>シミュレーションを開始する</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
