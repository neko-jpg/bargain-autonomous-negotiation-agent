'use client';

import Image from 'next/image';
import React, { useCallback, useState, useEffect } from 'react';
import { NegotiationSession } from '@/types/negotiation';
import { NegotiationTimeline } from './NegotiationTimeline';
import { DealModal } from './DealModal';
import { Sparkles, Play, Pause, RotateCcw, ArrowRight, Bot, Lock, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';

export const SwitchDemoView: React.FC = () => {
  const [session, setSession] = useState<NegotiationSession | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDealModalOpen, setIsDealModalOpen] = useState<boolean>(false);

  // 初期セッションのロード
  const loadInitialSession = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation/switch-demo');
      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        setCurrentStepIndex(0);
        setIsPlaying(false);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void loadInitialSession();
  }, [loadInitialSession]);

  // ステップ実行
  const executeStep = useCallback(async (stepIdx: number) => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const res = await fetch('/api/simulation/switch-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIndex: stepIdx }),
      });

      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        setCurrentStepIndex(stepIdx);
        if (data.isCompleted) {
          setIsPlaying(false);
          setIsDealModalOpen(true);
        }
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  // 自動再生タイマー
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isPlaying && currentStepIndex < 5) {
      timer = setTimeout(() => {
        executeStep(currentStepIndex + 1);
      }, 2000);
    } else if (currentStepIndex >= 5) {
      setIsPlaying(false);
    }
    return () => clearTimeout(timer);
  }, [currentStepIndex, executeStep, isPlaying]);

  const handleNext = () => {
    if (currentStepIndex < 5) {
      executeStep(currentStepIndex + 1);
    }
  };

  const handleReset = () => {
    loadInitialSession();
  };

  if (!session) {
    return <div className="p-12 text-center text-slate-400">Loading demo scenario...</div>;
  }

  const isDeal = session.status === 'deal';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fade-in">
      {/* Scenario Header */}
      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 border border-purple-500/30 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/30">
              <Sparkles className="w-3.5 h-3.5" />
              <span>企画書セクション22 デモシナリオ完全再現</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Nintendo Switch 交渉デモ (6 Actions to DEAL)
            </h2>
            <p className="text-xs sm:text-sm text-slate-300">
              買い手の上限(¥23,000)と売り手の最低価格(¥22,000)を保護しつつ、WAIT（待機）と需要変動を経て ¥22,500 で自動合意に至るプロセスを再生します。
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={isDeal}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all ${
                isPlaying
                  ? 'bg-amber-600 text-white'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30'
              } disabled:opacity-50`}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isPlaying ? '一時停止' : '自動再生 (Auto)'}</span>
            </button>

            <button
              onClick={handleNext}
              disabled={isLoading || isPlaying || isDeal}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50 flex items-center space-x-1"
            >
              <span>次のアクション</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleReset}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700"
              title="最初からやり直す"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Grid: Overview & Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Preset Policies & Private States */}
        <div className="lg:col-span-5 space-y-6">
          {/* Item details */}
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center space-x-4">
              <Image
                src={session.listing.imageUrl}
                alt={session.listing.title}
                width={80}
                height={80}
                className="w-20 h-20 rounded-2xl object-cover border border-slate-800"
              />
              <div>
                <span className="text-[10px] uppercase font-bold text-purple-400 bg-purple-950/50 px-2 py-0.5 rounded-full border border-purple-500/30">
                  出品中
                </span>
                <h3 className="text-sm font-bold text-white mt-1 line-clamp-1">
                  {session.listing.title}
                </h3>
                <div className="text-xl font-black font-mono text-white mt-0.5">
                  出品価格: ¥{session.listing.price.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Private States Comparison Box */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {/* Buyer Policy */}
              <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 space-y-1">
                <div className="text-xs font-bold text-indigo-300 flex items-center gap-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>買い手設定 (Buyer)</span>
                </div>
                <div className="text-xs text-slate-400">希望価格: ¥21,000</div>
                <div className="text-sm font-bold font-mono text-indigo-200 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>上限: ¥23,000</span>
                </div>
              </div>

              {/* Seller Policy */}
              <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-500/30 space-y-1">
                <div className="text-xs font-bold text-purple-300 flex items-center gap-1">
                  <Bot className="w-3.5 h-3.5" />
                  <span>売り手設定 (Seller)</span>
                </div>
                <div className="text-xs text-slate-400">希望価格: ¥24,000</div>
                <div className="text-sm font-bold font-mono text-purple-200 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>最低: ¥22,000</span>
                </div>
              </div>
            </div>

            {/* Step Progress indicator */}
            <div className="pt-2">
              <div className="flex justify-between text-xs font-medium text-slate-400 mb-1.5">
                <span>シナリオ進行状況</span>
                <span className="font-mono">{session.offers.length} / 6 アクション</span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {[1, 2, 3, 4, 5, 6].map((s) => (
                  <div
                    key={s}
                    className={`h-2 rounded-full transition-all ${
                      s <= session.offers.length
                        ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
                        : 'bg-slate-800'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Deal summary alert when finished */}
          {isDeal && session.dealSummary && (
            <div className="p-6 rounded-3xl bg-emerald-950/30 border border-emerald-500/40 shadow-xl space-y-4">
              <div className="flex items-center space-x-2 text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-extrabold text-base">取引成立 (DEAL: ¥22,500)</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                企画書通り、買い手は上限より ¥500 安く（定価より ¥2,500 節約）、売り手は最低価格より +¥500 上乗せで合意しました。
              </p>
              <button
                onClick={() => setIsDealModalOpen(true)}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
              >
                成果サマリーモーダルを開く
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Timeline */}
        <div className="lg:col-span-7">
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl">
            <NegotiationTimeline
              offers={session.offers}
              listing={session.listing}
              currentOfferPrice={session.currentOfferPrice}
            />
          </div>
        </div>
      </div>

      {session.dealSummary && (
        <DealModal
          summary={session.dealSummary}
          listing={session.listing}
          sellerSurplus={undefined}
          isOpen={isDealModalOpen}
          onClose={() => setIsDealModalOpen(false)}
        />
      )}
    </div>
  );
};
