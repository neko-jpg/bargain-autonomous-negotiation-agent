'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Button as AriaButton, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { motion } from 'motion/react';
import { Baby, BookOpen, Camera, ChevronRight, Gamepad2, Grid2X2, Home, Search, Shirt, Smartphone, Trophy, Utensils, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getCatalogCategories, getCatalogListings, searchCatalogListings, type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';
import { Listing } from '@/types/negotiation';

const iconByCategory: Record<CatalogCategoryId, LucideIcon> = {
  all: Grid2X2,
  games: Gamepad2,
  electronics: Smartphone,
  fashion: Shirt,
  sports: Trophy,
  media: BookOpen,
  living: Home,
  kitchen: Utensils,
  kids: Baby,
  other: Camera,
};

interface CategoryMegaMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectListing: (listing: Listing) => void;
  onSearch: (query: string) => void;
  onSelectCategory?: (categoryId: CatalogCategoryId) => void;
  initialCategoryId?: CatalogCategoryId;
}

export function CategoryMegaMenu({
  isOpen,
  onClose,
  onSelectListing,
  onSearch,
  onSelectCategory,
  initialCategoryId = 'games',
}: CategoryMegaMenuProps) {
  const [activeCategoryId, setActiveCategoryId] = useState<CatalogCategoryId>(initialCategoryId);
  const [query, setQuery] = useState('');
  const categories = useMemo(() => getCatalogCategories(), []);

  useEffect(() => {
    if (isOpen) {
      setActiveCategoryId(initialCategoryId);
      setQuery('');
    }
  }, [initialCategoryId, isOpen]);

  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? categories[0];
  const matchingListings = useMemo(() => {
    if (query.trim()) return searchCatalogListings(query, activeCategoryId).slice(0, 6);
    return getCatalogListings(activeCategoryId).slice(0, 6);
  }, [activeCategoryId, query]);

  const selectCategory = (categoryId: CatalogCategoryId) => {
    setActiveCategoryId(categoryId);
    onSelectCategory?.(categoryId);
  };

  const submitSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    onSearch(trimmed);
    onClose();
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className="category-overlay"
    >
      <Modal className="category-modal">
        <Dialog id="category-menu" aria-label="カテゴリから商品を探す" className="outline-none">
          {({ close }) => (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="category-popover shape-balanced"
            >
              <div className="category-popover__header">
                <div>
                  <p className="eyebrow">BARGAIN MARKET / CATEGORIES</p>
                  <Heading slot="title" className="mt-1 text-lg font-extrabold text-slate-950">カテゴリから探す</Heading>
                </div>
                <AriaButton aria-label="カテゴリメニューを閉じる" onPress={close} className="control-icon"><X className="h-5 w-5" aria-hidden="true" /></AriaButton>
              </div>

              <div className="category-popover__search">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <label htmlFor="category-search" className="sr-only">カテゴリ内の商品を検索</label>
                <input id="category-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitSearch(); }} placeholder="商品名・ブランド・タグで探す" autoFocus />
                <AriaButton onPress={submitSearch} className="secondary-button h-9 min-h-9 px-3 text-xs">検索</AriaButton>
              </div>

              <div className="category-popover__body">
                <nav aria-label="商品カテゴリ" className="category-list">
                  {categories.map((category) => {
                    const Icon = iconByCategory[category.id];
                    const isActive = category.id === activeCategoryId;
                    return (
                      <AriaButton
                        key={category.id}
                        onPress={() => selectCategory(category.id)}
                        className="category-list__item"
                        data-selected={isActive ? 'true' : undefined}
                      >
                        <span className={`category-list__icon category-list__icon--${category.accent}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1 truncate text-left">{category.label}</span>
                        <small>{category.count}</small>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </AriaButton>
                    );
                  })}
                </nav>

                <section className="category-results" aria-live="polite">
                  <div className="flex items-end justify-between gap-3">
                    <div><p className="eyebrow">{activeCategory?.label}</p><h2 className="mt-1 text-base font-bold text-slate-950">すぐ見られる商品</h2></div>
                    <AriaButton onPress={() => { onSelectCategory?.(activeCategoryId); close(); }} className="text-xs font-bold text-teal-800 hover:underline">このカテゴリを見る</AriaButton>
                  </div>
                  <div className="category-results__grid">
                    {matchingListings.map((listing) => (
                      <AriaButton key={listing.id} onPress={() => { onSelectListing(listing); close(); }} className="category-result-card">
                        <span className="category-result-card__image"><Image src={listing.imageUrl} alt="" width={54} height={54} sizes="54px" /></span>
                        <span className="min-w-0 text-left"><strong>{listing.title}</strong><small>{listing.categoryPath?.slice(1).join(' / ') || listing.category}</small><b>¥{listing.price.toLocaleString('ja-JP')}</b></span>
                      </AriaButton>
                    ))}
                  </div>
                  {matchingListings.length === 0 && <div className="empty-state mt-4 py-8"><Search className="h-5 w-5 text-slate-400" aria-hidden="true" /><p className="text-sm font-bold text-slate-700">該当する商品がありません</p></div>}
                </section>
              </div>

              <div className="category-popover__footer"><span>カテゴリを選ぶと一覧が即時に切り替わります。</span><AriaButton onPress={close} className="text-sm font-bold text-slate-600 hover:text-slate-950">閉じる</AriaButton></div>
            </motion.div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
