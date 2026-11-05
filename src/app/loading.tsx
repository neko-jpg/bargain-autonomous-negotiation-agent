'use client';

import { useI18n } from '@/lib/i18n/provider';

export default function Loading() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-6">
      <div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-700" /><p className="mt-4 text-sm font-semibold text-slate-600">{t('common.loading')}</p></div>
    </main>
  );
}
