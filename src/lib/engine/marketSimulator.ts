import { Listing, UrgencyLevel } from '@/types/negotiation';

export class MarketSimulator {
  /**
   * 出品情報と時間経過に基づいて市場メトリクスを動的に再計算する
   */
  static simulateTimePassed(listing: Listing, elapsedHours: number): Listing {
    const elapsedDays = elapsedHours / 24;
    const newDaysListed = listing.daysListed + elapsedDays;
    
    // 時間経過に伴う閲覧数・いいね数の増加シミュレーション
    const additionalViews = Math.floor(elapsedHours * (listing.recentDemand === 'high' ? 8 : listing.recentDemand === 'moderate' ? 3 : 1));
    const additionalLikes = Math.floor(additionalViews * 0.04);

    // 長期出品になるにつれて需要スコアが下がる傾向
    let newDemand = listing.recentDemand;
    if (newDaysListed > 20 && listing.recentDemand === 'high') {
      newDemand = 'moderate';
    } else if (newDaysListed > 30) {
      newDemand = 'low';
    }

    return {
      ...listing,
      daysListed: Math.round(newDaysListed * 10) / 10,
      viewsCount: listing.viewsCount + additionalViews,
      likesCount: listing.likesCount + additionalLikes,
      recentDemand: newDemand,
    };
  }

  /**
   * 需要や出品期間から取引成立確率 (Win Probability) を推定する (0% - 100%)
   */
  static estimateWinProbability(
    offerPrice: number,
    marketMedian: number,
    daysListed: number,
    demand: 'low' | 'moderate' | 'high',
    role: 'buyer' | 'seller'
  ): number {
    const priceRatio = offerPrice / marketMedian;
    let baseProb = 50;

    if (role === 'buyer') {
      // 買い手の場合、提示額が高いほど成約しやすい
      if (priceRatio >= 1.0) baseProb = 85;
      else if (priceRatio >= 0.95) baseProb = 75;
      else if (priceRatio >= 0.90) baseProb = 60;
      else if (priceRatio >= 0.85) baseProb = 40;
      else baseProb = 20;

      // 出品期間が長いほど、安くても受け入れられやすい
      if (daysListed > 25) baseProb += 15;
      else if (daysListed > 10) baseProb += 5;

      // 需要が高いと売り手は強気になるため成約率は下がる
      if (demand === 'high') baseProb -= 15;
      else if (demand === 'low') baseProb += 10;
    } else {
      // 売り手の場合、提示額が安いほど成約しやすい
      if (priceRatio <= 0.90) baseProb = 85;
      else if (priceRatio <= 0.95) baseProb = 75;
      else if (priceRatio <= 1.0) baseProb = 60;
      else if (priceRatio <= 1.05) baseProb = 40;
      else baseProb = 20;

      if (demand === 'high') baseProb += 15;
      else if (demand === 'low') baseProb -= 15;
    }

    return Math.min(95, Math.max(5, baseProb));
  }

  /**
   * BATNA (Best Alternative to a Negotiated Agreement: 最善代替価格) を算出
   */
  static calculateBATNA(
    listing: Listing,
    role: 'buyer' | 'seller',
    reservationPrice: number
  ): number {
    if (role === 'buyer') {
      // 買い手のBATNA: 市場で他の同等品を買う場合の予想実質コスト（相場中央値の若干のディスカウント期待値など）
      const alternativeDiscount = listing.competingListingsCount > 5 ? 0.96 : 0.98;
      return Math.min(reservationPrice, Math.round(listing.marketMedianPrice * alternativeDiscount));
    } else {
      // 売り手のBATNA: 他の買い手に売却、または時間経過後の値下げ売却期待値
      const demandMultiplier = listing.recentDemand === 'high' ? 0.98 : listing.recentDemand === 'moderate' ? 0.93 : 0.88;
      return Math.max(reservationPrice, Math.round(listing.marketMedianPrice * demandMultiplier));
    }
  }
}
