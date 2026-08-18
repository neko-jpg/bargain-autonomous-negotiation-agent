'use client';

import { FormEvent, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { motion } from 'motion/react';
import { Bell, Bot, ChevronDown, Heart, Menu, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { CategoryMegaMenu } from './CategoryMegaMenu';
import { Listing } from '@/types/negotiation';
import { type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';

export type ActiveScreen =
  | 'marketplace'
  | 'product-detail'
  | 'negotiation-live'
  | 'negotiation-detail'
  | 'seller-dashboard'
  | 'dashboard'
  | 'deal-summary';

interface NavbarProps {
  activeScreen: ActiveScreen;
  activeCategory: CatalogCategoryId;
  onSelectScreen: (screen: ActiveScreen) => void;
  onSelectCategory: (categoryId: CatalogCategoryId) => void;
  onOpenSwitchDemo: () => void;
  isDemoRunning?: boolean;
  onOpenApiNegotiation: () => void;
  isApiNegotiationStarting?: boolean;
  onSelectListing: (listing: Listing) => void;
  onSearch: (query: string) => void;
}

const categoryShortcuts: { label: string; id: CatalogCategoryId; accent: string }[] = [
  { label: 'ゲーム・ホビー', id: 'games', accent: 'plum' },
  { label: '家電・スマホ', id: 'electronics', accent: 'teal' },
  { label: 'ファッション', id: 'fashion', accent: 'coral' },
  { label: 'スポーツ', id: 'sports', accent: 'jade' },
];

const screens: { id: ActiveScreen; label: string }[] = [
  { id: 'marketplace', label: '商品を探す' },
  { id: 'negotiation-live', label: '交渉中' },
  { id: 'dashboard', label: 'レポート' },
  { id: 'seller-dashboard', label: '売り手向け' },
];

export function Navbar({
  activeScreen,
  activeCategory,
  onSelectScreen,
  onSelectCategory,
  onOpenSwitchDemo,
  isDemoRunning = false,
  onOpenApiNegotiation,
  isApiNegotiationStarting = false,
  onSelectListing,
  onSearch,
}: NavbarProps) {
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const submitSearch = (event?: FormEvent) => {
    event?.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setIsCategoryOpen(true);
      return;
    }
    onSearch(query);
  };

  const openCategory = () => {
    setMobileActionsOpen(false);
    setUserMenuOpen(false);
    setIsCategoryOpen(true);
  };

  const selectShortcut = (categoryId: CatalogCategoryId) => {
    onSelectCategory(categoryId);
    onSelectScreen('marketplace');
    setIsCategoryOpen(false);
    setMobileActionsOpen(false);
  };

  return (
    <>
      <header className="site-header">
        <div className="page-container relative">
          <div className="site-header__top">
            <AriaButton aria-label="商品を探す" onPress={() => onSelectScreen('marketplace')} className="brand-mark">
              <span className="brand-mark__symbol">B</span>
              <span className="brand-mark__word">BARGAIN</span>
            </AriaButton>

            <form onSubmit={submitSearch} className="global-search hidden min-w-0 flex-1 md:flex">
              <AriaButton type="button" onPress={openCategory} aria-expanded={isCategoryOpen} aria-controls="category-menu" className="global-search__category">
                <Menu className="h-4 w-4" aria-hidden="true" />カテゴリから探す<ChevronDown className={`h-4 w-4 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </AriaButton>
              <label htmlFor="global-search" className="sr-only">商品を検索</label>
              <input id="global-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="商品名・ブランド・カテゴリで検索" />
              <AriaButton type="submit" aria-label="検索" className="global-search__submit"><Search className="h-5 w-5" aria-hidden="true" /></AriaButton>
            </form>

            <div className="site-header__actions">
              <AriaButton aria-label="通知 3件" onPress={() => toast.info('未確認の交渉通知が3件あります。')} className="control-icon control-icon--quiet relative"><Bell className="h-5 w-5" aria-hidden="true" /><span className="notification-badge">3</span></AriaButton>
              <AriaButton aria-label="保存した商品" onPress={() => toast.info('保存した商品は商品カードのハートから確認できます。')} className="control-icon control-icon--quiet hidden sm:inline-flex"><Heart className="h-5 w-5" aria-hidden="true" /></AriaButton>
              <AriaButton aria-label="ユーザーメニュー" onPress={() => setUserMenuOpen((open) => !open)} aria-expanded={userMenuOpen} aria-controls="user-menu" className="user-button"><span className="user-button__avatar">YT</span><span className="hidden lg:block">山田 太郎</span><ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" aria-hidden="true" /></AriaButton>
              <AriaButton aria-label="メニューを開く" onPress={() => { setMobileActionsOpen((open) => !open); setUserMenuOpen(false); }} aria-expanded={mobileActionsOpen} aria-controls="mobile-actions" className="control-icon md:hidden">{mobileActionsOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}</AriaButton>
            </div>
          </div>

          {userMenuOpen && <div id="user-menu" role="dialog" aria-label="ユーザーメニュー" className="user-menu"><p className="eyebrow">BUYER WORKSPACE</p><p className="mt-1 font-bold text-slate-950">山田 太郎</p><p className="mt-1 text-sm text-slate-500">交渉ポリシー Level 2</p><div className="mt-3 grid gap-1 border-t border-slate-100 pt-2"><AriaButton onPress={() => { setUserMenuOpen(false); onSelectScreen('dashboard'); }} className="menu-item">交渉レポートを開く</AriaButton><AriaButton onPress={() => { setUserMenuOpen(false); toast.info('アカウント設定はモック環境のため表示のみです。'); }} className="menu-item">アカウント設定</AriaButton></div></div>}

          <div className="category-nav hidden md:flex">
            <AriaButton onPress={openCategory} aria-expanded={isCategoryOpen} aria-controls="category-menu" className={`category-nav__all ${isCategoryOpen ? 'is-open' : ''}`}><Menu className="h-4 w-4" aria-hidden="true" />カテゴリから探す<ChevronDown className={`h-4 w-4 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></AriaButton>
            <span className="category-nav__divider" aria-hidden="true" />
            {categoryShortcuts.map((category) => {
              const isActive = activeCategory === category.id && activeScreen === 'marketplace';
              return <AriaButton key={category.id} onPress={() => selectShortcut(category.id)} className={`category-nav__shortcut category-nav__shortcut--${category.accent}`} data-selected={isActive ? 'true' : undefined}>{category.label}</AriaButton>;
            })}
            <div className="category-nav__screens">
              {screens.map((screen) => {
                const isActive = activeScreen === screen.id;
                return <AriaButton key={screen.id} onPress={() => onSelectScreen(screen.id)} aria-current={isActive ? 'page' : undefined} className="screen-link" data-selected={isActive ? 'true' : undefined}>{isActive && <motion.span layoutId="active-nav" className="screen-link__marker" />}<span>{screen.label}</span></AriaButton>;
              })}
              <AriaButton onPress={onOpenSwitchDemo} isDisabled={isDemoRunning} isPending={isDemoRunning} className="demo-nav-button"><Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />{isDemoRunning ? 'デモ実行中…' : '6-Stepデモ'}</AriaButton>
              <AriaButton onPress={onOpenApiNegotiation} isDisabled={isApiNegotiationStarting} isPending={isApiNegotiationStarting} className="demo-nav-button"><Bot className="h-4 w-4 text-teal-200" aria-hidden="true" />{isApiNegotiationStarting ? 'API交渉中…' : '実API交渉'}</AriaButton>
            </div>
          </div>

          {mobileActionsOpen && <div id="mobile-actions" className="mobile-actions"><form onSubmit={submitSearch} className="mobile-actions__search"><Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" /><label htmlFor="mobile-search" className="sr-only">商品を検索</label><input id="mobile-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="商品名・カテゴリで検索" /><AriaButton type="submit" aria-label="検索" className="control-icon h-9 w-9"><Search className="h-4 w-4" aria-hidden="true" /></AriaButton></form><div className="mobile-actions__grid"><AriaButton onPress={openCategory} className="mobile-actions__category">カテゴリから探す</AriaButton>{categoryShortcuts.map((category) => <AriaButton key={category.id} onPress={() => selectShortcut(category.id)} className="mobile-actions__item">{category.label}</AriaButton>)}{screens.map((screen) => <AriaButton key={screen.id} onPress={() => { onSelectScreen(screen.id); setMobileActionsOpen(false); }} className="mobile-actions__item">{screen.label}</AriaButton>)}<AriaButton onPress={() => { setMobileActionsOpen(false); onOpenSwitchDemo(); }} isDisabled={isDemoRunning} className="mobile-actions__demo">6-Stepデモ</AriaButton><AriaButton onPress={() => { setMobileActionsOpen(false); onOpenApiNegotiation(); }} isDisabled={isApiNegotiationStarting} className="mobile-actions__demo"><Bot className="h-4 w-4" aria-hidden="true" />{isApiNegotiationStarting ? 'API交渉中…' : '実API交渉'}</AriaButton></div></div>}
        </div>
      </header>

      <CategoryMegaMenu isOpen={isCategoryOpen} onClose={() => setIsCategoryOpen(false)} onSelectListing={(listing) => { onSelectListing(listing); setIsCategoryOpen(false); }} onSearch={onSearch} onSelectCategory={selectShortcut} initialCategoryId={activeCategory} />
    </>
  );
}
