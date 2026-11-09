'use client';

import { useI18n } from '@/lib/i18n/provider';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-6"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><p className="eyebrow">{t('error.eyebrow')}</p><h1 className="mt-2 text-xl font-bold text-slate-950">{t('error.title')}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{t('error.body')}</p><button onClick={() => reset()} className="primary-button mt-6 w-full">{t('common.retry')}</button></div></main>
  );
}
