'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { BuyerPolicy, Listing, PublicNegotiationSession } from '@/types/negotiation';
import { Navbar, ActiveScreen } from '@/components/Navbar';
import { MarketplaceView } from '@/components/MarketplaceView';
import { ProductDetailView } from '@/components/ProductDetailView';
import { NegotiationLiveView } from '@/components/NegotiationLiveView';
import { NegotiationDetailView } from '@/components/NegotiationDetailView';
import { SellerDashboardView } from '@/components/SellerDashboardView';
import { DashboardView } from '@/components/DashboardView';
import { DealSummaryView } from '@/components/DealSummaryView';
import { DEMO_CATALOG_ID, getCatalogListings, type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';
import { useI18n } from '@/lib/i18n/provider';

const SESSION_STORAGE_KEY = 'bargain:active-session';
const SELLER_LISTING_STORAGE_KEY = 'bargain:seller-console-listing';
const VALID_SCREENS: ActiveScreen[] = ['marketplace', 'product-detail', 'negotiation-live', 'negotiation-detail', 'seller-dashboard', 'dashboard', 'deal-summary'];

/**
 * Requests from this screen only ever target this app's own API routes.
 * The allow-list keeps the generic fetch wrapper from becoming an SSRF sink:
 * absolute or cross-origin URLs are rejected before any network call.
 */
const ALLOWED_API_PREFIX = '/api/';

function allowedApiPath(apiPath: string): string {
  const isRelativeApiPath = apiPath.startsWith(ALLOWED_API_PREFIX);
  const isSameOriginApiPath = typeof window !== 'undefined'
    && apiPath.startsWith(`${window.location.origin}${ALLOWED_API_PREFIX}`);
  if (!isRelativeApiPath && !isSameOriginApiPath) {
    throw new Error(`Blocked request target: ${apiPath}`);
  }
  return apiPath;
}

async function fetchWithTimeout(apiPath: string, init?: RequestInit, timeoutMs = 15_000, timeoutMessage = 'Request timed out.') {
  const safeApiPath = allowedApiPath(apiPath);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(safeApiPath, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function Home() {
  const { t, formatYen } = useI18n();
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('marketplace');
  const [activeCategory, setActiveCategory] = useState<CatalogCategoryId>('all');
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [session, setSession] = useState<PublicNegotiationSession | null>(null);
  const [sellerListingId, setSellerListingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [isApiNegotiationStarting, setIsApiNegotiationStarting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const initialSessionPromise = useRef<Promise<PublicNegotiationSession> | null>(null);

  const listings = useMemo(() => getCatalogListings(activeCategory), [activeCategory]);
  const allListings = useMemo(() => getCatalogListings('all'), []);

  const pickSellerListing = useCallback((excludeId?: string) => {
    const candidates = allListings.filter((listing) => listing.id !== excludeId);
    const pool = candidates.length > 0 ? candidates : allListings;
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (!next) return;
    setSellerListingId(next.id);
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SELLER_LISTING_STORAGE_KEY, next.id);
  }, [allListings]);

  useEffect(() => {
    if (sellerListingId || allListings.length === 0) return;
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(SELLER_LISTING_STORAGE_KEY) : null;
    if (stored && allListings.some((listing) => listing.id === stored)) {
      setSellerListingId(stored);
      return;
    }
    pickSellerListing();
  }, [allListings, pickSellerListing, sellerListingId]);

  const persistSession = useCallback((nextSession: PublicNegotiationSession) => {
    setSession(nextSession);
    setSelectedListing(nextSession.listing);
    if (typeof window !== 'undefined') window.localStorage.setItem(SESSION_STORAGE_KEY, nextSession.id);
  }, []);

  const navigate = useCallback((screen: ActiveScreen) => {
    setActiveScreen(screen);
    if (typeof window !== 'undefined') window.history.pushState(null, '', `#${screen}`);
  }, []);

  const createSession = useCallback(async (listingId: string, buyerPolicy?: BuyerPolicy) => {
    const response = await fetchWithTimeout('/api/negotiations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, buyerPolicy }),
    }, 15_000, t('app.timeout'));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? t('app.errorCreateSession'));
    return payload.session as PublicNegotiationSession;
  }, [t]);

  const getInitialSession = useCallback(() => {
    if (!initialSessionPromise.current) {
      initialSessionPromise.current = (async () => {
        const savedId = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (savedId) {
          const response = await fetchWithTimeout(`/api/negotiations/${encodeURIComponent(savedId)}`, { cache: 'no-store' }, 15_000, t('app.timeout'));
          if (response.ok) {
            const payload = await response.json();
            if (payload.session) return payload.session as PublicNegotiationSession;
          }
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
        }
        return createSession(DEMO_CATALOG_ID);
      })();
    }
    return initialSessionPromise.current;
  }, [createSession, t]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const nextSession = await getInitialSession();
        if (!cancelled) persistSession(nextSession);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : t('app.loadErrorFallback'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();

    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '') as ActiveScreen;
      if (VALID_SCREENS.includes(hash)) setActiveScreen(hash);
    };
    onHashChange();
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, [getInitialSession, persistSession, t]);

  const handleSelectCategory = useCallback((categoryId: CatalogCategoryId) => {
    setActiveCategory(categoryId);
    navigate('marketplace');
  }, [navigate]);

  const handleSelectListing = useCallback((listing: Listing) => {
    // Browsing is read-only: a negotiation is created only when the user
    // starts one, so out-of-order responses cannot swap the visible product.
    setSelectedListing(listing);
    navigate('product-detail');
  }, [navigate]);

  const handleSearch = useCallback(async (query: string) => {
    const response = await fetch(`/api/listings?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      const first = payload.listings?.[0] as Listing | undefined;
      if (first) {
        handleSelectListing(first);
        return;
      }
    }
    toast.info(t('market.searchNoMatch', { query }));
  }, [handleSelectListing, t]);

  const activeListing = selectedListing ?? session?.listing;
  const sellerListing = allListings.find((listing) => listing.id === sellerListingId) ?? session?.listing ?? allListings[0];
  const sellerSession = sellerListing && session?.listing.id === sellerListing.id ? session : undefined;

  const handleStartNegotiation = useCallback(async (policy: BuyerPolicy) => {
    if (!activeListing) return;
    try {
      const nextSession = await createSession(activeListing.id, policy);
      persistSession(nextSession);
      navigate('negotiation-live');
      toast.success(t('app.sessionCreated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('app.errorStartNegotiation'));
    }
  }, [activeListing, createSession, navigate, persistSession, t]);

  const handleBuyNow = useCallback(async (price: number) => {
    if (!activeListing) return;
    try {
      const buyPolicy: BuyerPolicy = { targetPrice: price, maxPrice: price, deadlineDays: 1, autoPurchase: false, autoNegotiate: false };
      const created = await createSession(activeListing.id, buyPolicy);
      const offerResponse = await fetchWithTimeout(`/api/negotiations/${created.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'human_offer', expectedVersion: created.version, idempotencyKey: `${created.id}-buy-offer`, offerPrice: price, messageText: t('app.buyOfferMessage') }),
      }, 15_000, t('app.timeout'));
      const offerPayload = await offerResponse.json();
      if (!offerResponse.ok) throw new Error(offerPayload.message ?? t('app.errorBuyOffer'));
      const nextStep = await fetchWithTimeout(`/api/negotiations/${created.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'auto_step', expectedVersion: offerPayload.session.version, idempotencyKey: `${created.id}-buy-response` }),
      }, 15_000, t('app.timeout'));
      const nextPayload = await nextStep.json();
      if (!nextStep.ok) throw new Error(nextPayload.message ?? t('app.errorSellerResponse'));
      persistSession(nextPayload.session);
      navigate(nextPayload.session.status === 'deal' ? 'deal-summary' : 'negotiation-live');
      toast.success(nextPayload.session.status === 'deal' ? t('app.buyComplete') : nextPayload.session.status === 'awaiting_commit' ? t('app.buyAwaitingApproval') : t('app.buyOfferSent'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('app.errorBuyOffer'));
    }
  }, [activeListing, createSession, navigate, persistSession, t]);

  const handleRunSwitchDemo = useCallback(async () => {
    if (isDemoRunning) return;
    setIsDemoRunning(true);
    try {
      const startResponse = await fetch('/api/simulation/switch-demo', { method: 'POST' });
      const startPayload = await startResponse.json();
      if (!startResponse.ok) throw new Error(startPayload.message ?? t('app.errorDemoStart'));
      let current = startPayload.session as PublicNegotiationSession;
      persistSession(current);
      navigate('negotiation-live');
      toast.info(t('app.demoStarted'));

      for (let stepIndex = 0; stepIndex < 6; stepIndex += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        const response = await fetch('/api/simulation/switch-demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: current.id, stepIndex }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? t('app.errorDemoStep'));
        current = payload.session as PublicNegotiationSession;
        persistSession(current);
        if (payload.isCompleted) {
          navigate('deal-summary');
          toast.success(t('app.demoDeal', { price: formatYen(current.dealSummary?.agreedPrice ?? 0) }));
          break;
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('app.errorDemo'));
    } finally {
      setIsDemoRunning(false);
    }
  }, [formatYen, isDemoRunning, navigate, persistSession, t]);

  const handleRunApiNegotiation = useCallback(async () => {
    if (isApiNegotiationStarting) return;
    setIsApiNegotiationStarting(true);
    try {
      const created = await createSession(DEMO_CATALOG_ID);
      const response = await fetch(`/api/negotiations/${created.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'auto_step',
          expectedVersion: created.version,
          idempotencyKey: `${created.id}-api-start-${Date.now()}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? t('app.errorApiStart'));
      const nextSession = payload.session as PublicNegotiationSession;
      persistSession(nextSession);
      navigate(nextSession.status === 'deal' ? 'deal-summary' : 'negotiation-live');
      toast.success(t('app.apiStarted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('app.errorApiStart'));
    } finally {
      setIsApiNegotiationStarting(false);
    }
  }, [createSession, isApiNegotiationStarting, navigate, persistSession, t]);

  const handleOpenSellerNegotiation = useCallback(async () => {
    if (!sellerListing) return;
    if (sellerSession) {
      navigate('negotiation-live');
      return;
    }
    try {
      const nextSession = await createSession(sellerListing.id);
      persistSession(nextSession);
      navigate('negotiation-live');
      toast.success(t('app.sellerSessionCreated', { title: sellerListing.title }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('app.errorCreateSession'));
    }
  }, [createSession, navigate, persistSession, sellerListing, sellerSession, t]);

  const handleOpenSellerListing = useCallback(() => {
    if (sellerListing) handleSelectListing(sellerListing);
  }, [handleSelectListing, sellerListing]);

  if (isLoading) return <div className="app-loading"><span className="loading-dot" />{t('app.loading')}</div>;
  if (loadError || !session || !activeListing) return <div className="app-loading app-loading--error"><p className="text-lg font-bold text-slate-950">{t('app.loadErrorTitle')}</p><p className="text-sm text-slate-600">{loadError}</p><button onClick={() => window.location.reload()} className="primary-button">{t('common.reload')}</button></div>;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <Toaster position="top-right" richColors closeButton />
        <Navbar activeScreen={activeScreen} activeCategory={activeCategory} onSelectScreen={navigate} onSelectCategory={handleSelectCategory} onOpenSwitchDemo={handleRunSwitchDemo} isDemoRunning={isDemoRunning} onOpenApiNegotiation={handleRunApiNegotiation} isApiNegotiationStarting={isApiNegotiationStarting} onSelectListing={handleSelectListing} onSearch={handleSearch} />
        <main className="app-main" aria-busy={isDemoRunning || isApiNegotiationStarting}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeScreen} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
              {activeScreen === 'marketplace' && <MarketplaceView listings={listings} activeCategory={activeCategory} onCategoryChange={handleSelectCategory} onSelectListing={handleSelectListing} onRunDemo={handleRunSwitchDemo} isDemoRunning={isDemoRunning} onRunApiNegotiation={handleRunApiNegotiation} isApiNegotiationStarting={isApiNegotiationStarting} />}
              {activeScreen === 'product-detail' && <ProductDetailView key={activeListing.id} listing={activeListing} onStartNegotiation={handleStartNegotiation} onBuyNow={handleBuyNow} />}
              {activeScreen === 'negotiation-live' && <NegotiationLiveView session={session} onUpdateSession={persistSession} onGoToDetail={() => navigate('negotiation-detail')} onGoToDeal={() => navigate('deal-summary')} />}
              {activeScreen === 'negotiation-detail' && <NegotiationDetailView session={session} onBackToLive={() => navigate('negotiation-live')} />}
              {activeScreen === 'seller-dashboard' && sellerListing && <SellerDashboardView listing={sellerListing} session={sellerSession} onRerollListing={() => pickSellerListing(sellerListing.id)} onOpenListing={handleOpenSellerListing} onOpenNegotiation={handleOpenSellerNegotiation} />}
              {activeScreen === 'dashboard' && <DashboardView session={session} onSelectNegotiation={() => navigate('negotiation-live')} />}
              {activeScreen === 'deal-summary' && <DealSummaryView summary={session.dealSummary} listing={session.listing} offers={session.offers} buyerMaxPrice={session.viewer?.role === 'buyer' && 'maxPrice' in session.viewer.policy ? session.viewer.policy.maxPrice : undefined} sellerSurplus={session.viewerDealSummary?.sellerSurplus} negotiationId={session.id} commitReceipt={session.commitReceipt} onGoToDetail={() => navigate('negotiation-detail')} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="site-footer"><div className="page-container flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-slate-800">{t('common.appName')} — {t('common.appTagline')}</p><p>{t('common.disclaimer')}</p></div></footer>
      </div>
    </MotionConfig>
  );
}
