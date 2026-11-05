'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';

export default function NotFound() {
  const { t } = useI18n();
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-6"><div className="text-center"><p className="eyebrow">404</p><h1 className="mt-2 text-2xl font-bold text-slate-950">{t('notFound.title')}</h1><Link href="/" className="primary-button mt-6">{t('notFound.action')}</Link></div></main>;
}
