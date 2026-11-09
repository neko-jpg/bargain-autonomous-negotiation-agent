'use client';

import { FormEvent, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { motion } from 'motion/react';
import { Bell, Bot, ChevronDown, Heart, Menu, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { CategoryMegaMenu } from './CategoryMegaMenu';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Listing } from '@/types/negotiation';
import { type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/dictionary';

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

const categoryShortcuts: { labelKey: TranslationKey; id: CatalogCategoryId; accent: string }[] = [
  { labelKey: 'category.games', id: 'games', accent: 'plum' },
  { labelKey: 'category.electronics', id: 'electronics', accent: 'teal' },
  { labelKey: 'category.fashion', id: 'fashion', accent: 'coral' },
  { labelKey: 'category.sports', id: 'sports', accent: 'jade' },
];

const screens: { id: ActiveScreen; labelKey: TranslationKey }[] = [
  { id: 'marketplace', labelKey: 'nav.marketplace' },
  { id: 'negotiation-live', labelKey: 'nav.live' },
  { id: 'dashboard', labelKey: 'nav.report' },
  { id: 'seller-dashboard', labelKey: 'nav.seller' },
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
  const { t } = useI18n();
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
            <AriaButton aria-label={t('nav.brandAria')} onPress={() => onSelectScreen('marketplace')} className="brand-mark">
              <span className="brand-mark__symbol">B</span>
              <span className="brand-mark__word">BARGAIN</span>
            </AriaButton>

            <form onSubmit={submitSearch} className="global-search hidden min-w-0 flex-1 md:flex">
              <AriaButton type="button" onPress={openCategory} aria-expanded={isCategoryOpen} aria-controls="category-menu" className="global-search__category">
                <Menu className="h-4 w-4" aria-hidden="true" />{t('nav.categorySearch')}<ChevronDown className={`h-4 w-4 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </AriaButton>
              <label htmlFor="global-search" className="sr-only">{t('nav.searchLabel')}</label>
              <input id="global-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('nav.searchPlaceholder')} />
              <AriaButton type="submit" aria-label={t('nav.submitSearch')} className="global-search__submit"><Search className="h-5 w-5" aria-hidden="true" /></AriaButton>
            </form>

            <div className="site-header__actions">
              <LocaleSwitcher />
              <AriaButton aria-label={t('nav.notificationsAria')} onPress={() => toast.info(t('nav.notificationsToast'))} className="control-icon control-icon--quiet relative"><Bell className="h-5 w-5" aria-hidden="true" /><span className="notification-badge">3</span></AriaButton>
              <AriaButton aria-label={t('nav.saved')} onPress={() => toast.info(t('nav.savedToast'))} className="control-icon control-icon--quiet hidden sm:inline-flex"><Heart className="h-5 w-5" aria-hidden="true" /></AriaButton>
              <AriaButton aria-label={t('nav.userMenu')} onPress={() => setUserMenuOpen((open) => !open)} aria-expanded={userMenuOpen} aria-controls="user-menu" className="user-button"><span className="user-button__avatar">YT</span><span className="hidden lg:block">{t('nav.userName')}</span><ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" aria-hidden="true" /></AriaButton>
              <AriaButton aria-label={t('nav.menuOpen')} onPress={() => { setMobileActionsOpen((open) => !open); setUserMenuOpen(false); }} aria-expanded={mobileActionsOpen} aria-controls="mobile-actions" className="control-icon md:hidden">{mobileActionsOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}</AriaButton>
            </div>
          </div>

          {userMenuOpen && <div id="user-menu" role="dialog" aria-label={t('nav.userMenu')} className="user-menu"><p className="eyebrow">{t('nav.buyerWorkspace')}</p><p className="mt-1 font-bold text-slate-950">{t('nav.userName')}</p><p className="mt-1 text-sm text-slate-500">{t('nav.userPlan')}</p><div className="mt-3 grid gap-1 border-t border-slate-100 pt-2"><AriaButton onPress={() => { setUserMenuOpen(false); onSelectScreen('dashboard'); }} className="menu-item">{t('nav.openReport')}</AriaButton><AriaButton onPress={() => { setUserMenuOpen(false); toast.info(t('nav.accountSettingsToast')); }} className="menu-item">{t('nav.accountSettings')}</AriaButton></div></div>}

          <div className="category-nav hidden md:flex">
            <AriaButton onPress={openCategory} aria-expanded={isCategoryOpen} aria-controls="category-menu" className={`category-nav__all ${isCategoryOpen ? 'is-open' : ''}`}><Menu className="h-4 w-4" aria-hidden="true" />{t('nav.categorySearch')}<ChevronDown className={`h-4 w-4 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></AriaButton>
            <span className="category-nav__divider" aria-hidden="true" />
            {categoryShortcuts.map((category) => {
              const isActive = activeCategory === category.id && activeScreen === 'marketplace';
              return <AriaButton key={category.id} onPress={() => selectShortcut(category.id)} className={`category-nav__shortcut category-nav__shortcut--${category.accent}`} data-selected={isActive ? 'true' : undefined}>{t(category.labelKey)}</AriaButton>;
            })}
            <div className="category-nav__screens">
              {screens.map((screen) => {
                const isActive = activeScreen === screen.id;
                return <AriaButton key={screen.id} onPress={() => onSelectScreen(screen.id)} aria-current={isActive ? 'page' : undefined} className="screen-link" data-selected={isActive ? 'true' : undefined}>{isActive && <motion.span layoutId="active-nav" className="screen-link__marker" />}<span>{t(screen.labelKey)}</span></AriaButton>;
              })}
              <AriaButton onPress={onOpenSwitchDemo} isDisabled={isDemoRunning} isPending={isDemoRunning} className="demo-nav-button"><Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />{isDemoRunning ? t('nav.demoRunning') : t('nav.demo')}</AriaButton>
              <AriaButton onPress={onOpenApiNegotiation} isDisabled={isApiNegotiationStarting} isPending={isApiNegotiationStarting} className="demo-nav-button"><Bot className="h-4 w-4 text-teal-200" aria-hidden="true" />{isApiNegotiationStarting ? t('nav.apiStarting') : t('nav.api')}</AriaButton>
            </div>
          </div>

          {mobileActionsOpen && <div id="mobile-actions" className="mobile-actions"><form onSubmit={submitSearch} className="mobile-actions__search"><Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" /><label htmlFor="mobile-search" className="sr-only">{t('nav.searchLabel')}</label><input id="mobile-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('nav.mobileSearchPlaceholder')} /><AriaButton type="submit" aria-label={t('nav.submitSearch')} className="control-icon h-9 w-9"><Search className="h-4 w-4" aria-hidden="true" /></AriaButton></form><div className="mobile-actions__grid"><AriaButton onPress={openCategory} className="mobile-actions__category">{t('nav.categorySearch')}</AriaButton>{categoryShortcuts.map((category) => <AriaButton key={category.id} onPress={() => selectShortcut(category.id)} className="mobile-actions__item">{t(category.labelKey)}</AriaButton>)}{screens.map((screen) => <AriaButton key={screen.id} onPress={() => { onSelectScreen(screen.id); setMobileActionsOpen(false); }} className="mobile-actions__item">{t(screen.labelKey)}</AriaButton>)}<AriaButton onPress={() => { setMobileActionsOpen(false); onOpenSwitchDemo(); }} isDisabled={isDemoRunning} className="mobile-actions__demo">{t('nav.demo')}</AriaButton><AriaButton onPress={() => { setMobileActionsOpen(false); onOpenApiNegotiation(); }} isDisabled={isApiNegotiationStarting} className="mobile-actions__demo"><Bot className="h-4 w-4" aria-hidden="true" />{isApiNegotiationStarting ? t('nav.apiStarting') : t('nav.api')}</AriaButton></div></div>}
        </div>
      </header>

      <CategoryMegaMenu isOpen={isCategoryOpen} onClose={() => setIsCategoryOpen(false)} onSelectListing={(listing) => { onSelectListing(listing); setIsCategoryOpen(false); }} onSearch={onSearch} onSelectCategory={selectShortcut} initialCategoryId={activeCategory} />
    </>
  );
}
