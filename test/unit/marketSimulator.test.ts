import { MarketSimulator } from '../../src/lib/engine/marketSimulator';
import { INITIAL_LISTINGS } from '../../src/lib/mockData';

export function runMarketSimulatorTests(): boolean {
  console.log('\n--- 📊 Running Market Simulator Unit Tests ---');
  let passed = true;
  const listing = { ...(INITIAL_LISTINGS.find((candidate) => candidate.id === 'demo-000027') ?? INITIAL_LISTINGS[0]), recentDemand: 'moderate' as const, daysListed: 11 };

  const scoreLow = MarketSimulator.estimateAcceptanceScore(Math.round(listing.marketMedianPrice * 0.8), listing.marketMedianPrice, listing.daysListed, listing.recentDemand, 'buyer');
  const scoreFair = MarketSimulator.estimateAcceptanceScore(Math.round(listing.marketMedianPrice * 0.95), listing.marketMedianPrice, listing.daysListed, listing.recentDemand, 'buyer');
  const scoreHigh = MarketSimulator.estimateAcceptanceScore(Math.round(listing.marketMedianPrice * 1.05), listing.marketMedianPrice, listing.daysListed, listing.recentDemand, 'buyer');

  if (scoreLow < scoreFair && scoreFair < scoreHigh && scoreHigh >= 85) {
    console.log(`✅ [PASS] Acceptance score monotonically increases with offer price: Low=${scoreLow}, Fair=${scoreFair}, High=${scoreHigh}`);
  } else {
    console.error(`❌ [FAIL] Acceptance score calculation unexpected: Low=${scoreLow}, Fair=${scoreFair}, High=${scoreHigh}`);
    passed = false;
  }

  const buyerReservation = Math.round(listing.price * 0.92);
  const sellerReservation = Math.round(listing.price * 0.88);
  const buyerBatna = MarketSimulator.calculateBATNA(listing, 'buyer', buyerReservation);
  const sellerBatna = MarketSimulator.calculateBATNA(listing, 'seller', sellerReservation);
  if (buyerBatna <= buyerReservation && sellerBatna >= sellerReservation) {
    console.log(`✅ [PASS] BATNA calculated within rational bounds: Buyer=¥${buyerBatna.toLocaleString()}, Seller=¥${sellerBatna.toLocaleString()}`);
  } else {
    console.error(`❌ [FAIL] BATNA out of bounds: Buyer=${buyerBatna}, Seller=${sellerBatna}`);
    passed = false;
  }

  const updatedListing = MarketSimulator.simulateTimePassed(listing, 24);
  if (updatedListing.viewsCount >= listing.viewsCount && updatedListing.daysListed > listing.daysListed) {
    console.log(`✅ [PASS] simulateTimePassed incremented daysListed to ${updatedListing.daysListed} and views to ${updatedListing.viewsCount}`);
  } else {
    console.error('❌ [FAIL] Time passed simulation did not update fields properly');
    passed = false;
  }

  return passed;
}
