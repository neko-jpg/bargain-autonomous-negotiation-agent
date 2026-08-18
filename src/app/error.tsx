'use client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-6"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><p className="eyebrow">BARGAIN ERROR</p><h1 className="mt-2 text-xl font-bold text-slate-950">画面を読み込めませんでした</h1><p className="mt-3 text-sm leading-6 text-slate-600">一時的な問題が発生しました。再試行すると現在の状態から復旧できます。</p><button onClick={() => reset()} className="primary-button mt-6 w-full">再試行</button></div></main>
  );
}

