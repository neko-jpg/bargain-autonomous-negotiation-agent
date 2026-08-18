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

const SESSION_STORAGE_KEY = 'bargain:active-session';
const SELLER_LISTING_STORAGE_KEY = 'bargain:seller-console-listing';
const VALID_SCREENS: ActiveScreen[] = ['marketplace', 'product-detail', 'negotiation-live', 'negotiation-detail', 'seller-dashboard', 'dashboard', 'deal-summary'];

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('サーバーからの応答がタイムアウトしました。開発サーバーを再起動して再試行してください。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function Home() {
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
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? '交渉セッションを作成できませんでした。');
    return payload.session as PublicNegotiationSession;
  }, []);

  const getInitialSession = useCallback(() => {
    if (!initialSessionPromise.current) {
      initialSessionPromise.current = (async () => {
        const savedId = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (savedId) {
          const response = await fetchWithTimeout(`/api/negotiations/${encodeURIComponent(savedId)}`, { cache: 'no-store' });
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
  }, [createSession]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const nextSession = await getInitialSession();
        if (!cancelled) persistSession(nextSession);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '画面を読み込めませんでした。');
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
  }, [getInitialSession, persistSession]);

  const handleSelectCategory = useCallback((categoryId: CatalogCategoryId) => {
    setActiveCategory(categoryId);
    navigate('marketplace');
  }, [navigate]);

  const handleSelectListing = useCallback((listing: Listing) => {
    // Change the visible detail optimistically. Session creation happens in the
    // background so a card press never waits for the negotiation API.
    setSelectedListing(listing);
    navigate('product-detail');
    void createSession(listing.id)
      .then((nextSession) => persistSession(nextSession))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : '商品データを読み込めませんでした。'));
  }, [createSession, navigate, persistSession]);

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
    toast.info(`「${query}」に一致する商品はありません。`);
  }, [handleSelectListing]);

  const activeListing = selectedListing ?? session?.listing;
  const sellerListing = allListings.find((listing) => listing.id === sellerListingId) ?? session?.listing ?? allListings[0];
  const sellerSession = sellerListing && session?.listing.id === sellerListing.id ? session : undefined;

  const handleStartNegotiation = useCallback(async (policy: BuyerPolicy) => {
    if (!activeListing) return;
    try {
      const nextSession = await createSession(activeListing.id, policy);
      persistSession(nextSession);
      navigate('negotiation-live');
      toast.success('交渉セッションを作成しました。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '交渉を開始できませんでした。');
    }
  }, [activeListing, createSession, navigate, persistSession]);

  const handleBuyNow = useCallback(async (price: number) => {
    if (!activeListing) return;
    try {
      const buyPolicy: BuyerPolicy = { targetPrice: price, maxPrice: price, deadlineDays: 1, autoPurchase: true, autoNegotiate: false, delegationLevel: 3 };
      const created = await createSession(activeListing.id, buyPolicy);
      const offerResponse = await fetch(`/api/negotiations/${created.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'human_offer', expectedVersion: created.version, idempotencyKey: `${created.id}-buy-offer`, offerPrice: price, messageText: '表示価格で購入します。' }),
      });
      const offerPayload = await offerResponse.json();
      if (!offerResponse.ok) throw new Error(offerPayload.message ?? '購入確認を作成できませんでした。');
      const accepted = await fetch(`/api/negotiations/${created.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'human_accept', expectedVersion: offerPayload.session.version, idempotencyKey: `${created.id}-buy-accept` }),
      });
      const acceptedPayload = await accepted.json();
      if (!accepted.ok) throw new Error(acceptedPayload.message ?? '購入確認を完了できませんでした。');
      persistSession(acceptedPayload.session);
      navigate('deal-summary');
      toast.success('購入確認を作成しました。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '購入確認を作成できませんでした。');
    }
  }, [activeListing, createSession, navigate, persistSession]);

  const handleRunSwitchDemo = useCallback(async () => {
    if (isDemoRunning) return;
    setIsDemoRunning(true);
    try {
      const startResponse = await fetch('/api/simulation/switch-demo', { method: 'POST' });
      const startPayload = await startResponse.json();
      if (!startResponse.ok) throw new Error(startPayload.message ?? 'デモを開始できませんでした。');
      let current = startPayload.session as PublicNegotiationSession;
      persistSession(current);
      navigate('negotiation-live');
      toast.info('Curated 6-Stepデモを開始しました。');

      for (let stepIndex = 0; stepIndex < 6; stepIndex += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        const response = await fetch('/api/simulation/switch-demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: current.id, stepIndex }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? 'デモのステップを実行できませんでした。');
        current = payload.session as PublicNegotiationSession;
        persistSession(current);
        if (payload.isCompleted) {
          navigate('deal-summary');
          toast.success(`DEALが成立しました。合意価格 ${current.dealSummary?.agreedPrice.toLocaleString('ja-JP')}円`);
          break;
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'デモ実行中にエラーが発生しました。');
    } finally {
      setIsDemoRunning(false);
    }
  }, [isDemoRunning, navigate, persistSession]);

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
      if (!response.ok) throw new Error(payload.message ?? 'API経由の交渉を開始できませんでした。');
      const nextSession = payload.session as PublicNegotiationSession;
      persistSession(nextSession);
      navigate(nextSession.status === 'deal' ? 'deal-summary' : 'negotiation-live');
      toast.success('LLM API経由の交渉を開始しました。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'API経由の交渉を開始できませんでした。');
    } finally {
      setIsApiNegotiationStarting(false);
    }
  }, [createSession, isApiNegotiationStarting, navigate, persistSession]);

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
      toast.success(`${sellerListing.title}の交渉セッションを作成しました。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '交渉セッションを作成できませんでした。');
    }
  }, [createSession, navigate, persistSession, sellerListing, sellerSession]);

  const handleOpenSellerListing = useCallback(() => {
    if (sellerListing) handleSelectListing(sellerListing);
  }, [handleSelectListing, sellerListing]);

  if (isLoading) return <div className="app-loading"><span className="loading-dot" />BARGAINを準備しています…</div>;
  if (loadError || !session || !activeListing) return <div className="app-loading app-loading--error"><p className="text-lg font-bold text-slate-950">読み込みに失敗しました</p><p className="text-sm text-slate-600">{loadError}</p><button onClick={() => window.location.reload()} className="primary-button">再読み込み</button></div>;

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
              {activeScreen === 'deal-summary' && <DealSummaryView summary={session.dealSummary} listing={session.listing} offers={session.offers} buyerMaxPrice={session.buyerPolicy.maxPrice} negotiationId={session.id} onGoToDetail={() => navigate('negotiation-detail')} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="site-footer"><div className="page-container flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-slate-800">BARGAIN — Autonomous Negotiation Agent</p><p>AIの予測は目安であり、成約を保証するものではありません。</p></div></footer>
      </div>
    </MotionConfig>
  );
}
