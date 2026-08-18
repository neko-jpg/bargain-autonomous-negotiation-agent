import { CATALOG_ITEMS, CATALOG_ITEM_COUNT } from './catalogData.generated';
import type { MercariItem } from './types';
import { Listing } from '@/types/negotiation';

export type CatalogCategoryId =
  | 'all'
  | 'games'
  | 'electronics'
  | 'fashion'
  | 'sports'
  | 'media'
  | 'living'
  | 'kitchen'
  | 'kids'
  | 'other';

export interface CatalogCategoryGroup {
  id: CatalogCategoryId;
  label: string;
  sourceCategories: string[];
  count: number;
  accent: 'teal' | 'coral' | 'mustard' | 'plum' | 'jade' | 'blue' | 'sage' | 'rose' | 'slate';
}

const roundToHundred = (value: number) => Math.max(100, Math.round(value / 100) * 100);

const categoryDefinitions: Omit<CatalogCategoryGroup, 'count'>[] = [
  { id: 'all', label: 'すべて', sourceCategories: [], accent: 'slate' },
  { id: 'games', label: 'ゲーム・ホビー', sourceCategories: ['ゲーム・おもちゃ・グッズ', 'ホビー'], accent: 'plum' },
  { id: 'electronics', label: '家電・スマホ', sourceCategories: ['家電・スマホ'], accent: 'teal' },
  { id: 'fashion', label: 'ファッション', sourceCategories: ['ファッション', 'レディース', 'メンズ'], accent: 'coral' },
  { id: 'sports', label: 'スポーツ', sourceCategories: ['スポーツ・レジャー'], accent: 'jade' },
  { id: 'media', label: '本・マンガ', sourceCategories: ['本・マンガ'], accent: 'blue' },
  { id: 'living', label: 'インテリア・住まい', sourceCategories: ['インテリア・住まい・小物'], accent: 'mustard' },
  { id: 'kitchen', label: 'キッチン用品', sourceCategories: ['キッチン用品'], accent: 'sage' },
  { id: 'kids', label: 'ベビー・キッズ', sourceCategories: ['ベビー・キッズ'], accent: 'rose' },
  { id: 'other', label: 'その他', sourceCategories: [], accent: 'slate' },
];

const categoryIdBySource = new Map<string, CatalogCategoryId>(
  categoryDefinitions.flatMap((definition) => definition.sourceCategories.map((source) => [source, definition.id] as const)),
);

const conditionMap: Record<string, Listing['condition']> = {
  新品: 'new',
  未使用: 'new',
  未使用に近い: 'like_new',
  ほぼ新品: 'like_new',
  目立った傷や汚れなし: 'good',
  良好: 'good',
  やや傷や汚れあり: 'fair',
  傷や汚れあり: 'fair',
};

function numericId(item: MercariItem) {
  const match = item.id.match(/(\d+)$/);
  return match ? Number(match[1]) : 1;
}

function categoryIdFor(item: MercariItem): CatalogCategoryId {
  return categoryIdBySource.get(item.category[0] ?? '') ?? 'other';
}

function mapCatalogItem(item: MercariItem): Listing {
  const serial = numericId(item);
  const imageUrl = item.images[0] ?? '/images/products/pexels-selected/0001-pexels-1432236.jpg';
  const categoryPath = item.category;
  const sourceCategory = categoryPath[0] ?? 'その他';
  const displayTitle = item.title.replace(/\s+デモ出品\s+#\d+$/, '');
  const likesCount = item.likesCount ?? 0;
  const viewsCount = item.viewsCount ?? likesCount * 14;
  const marketRatio = 0.91 + (serial % 7) * 0.015;

  return {
    id: item.id,
    title: displayTitle,
    catalogTitle: item.title,
    price: item.price,
    category: sourceCategory,
    categoryPath,
    subcategory: categoryPath[1],
    imageUrl,
    images: item.images,
    description: item.description,
    daysListed: 2 + (serial % 19),
    likesCount,
    viewsCount,
    marketMedianPrice: roundToHundred(item.price * marketRatio),
    competingListingsCount: 2 + (serial % 8),
    recentDemand: likesCount >= 45 ? 'high' : likesCount >= 18 ? 'moderate' : 'low',
    sellerName: item.seller.name,
    sellerRating: item.seller.rating,
    sellerRatingsCount: item.seller.ratingsCount,
    condition: conditionMap[item.condition] ?? 'good',
    brand: item.brand,
    size: item.size,
    color: item.color,
    shippingMethod: item.shippingMethod,
    shippingDays: item.shippingDays,
    shippingSize: item.shippingSize,
    inventoryQuantity: item.inventoryQuantity,
    searchTags: item.searchTags,
    catalogSource: {
      photographer: item.sourcePhotographer,
      attribution: item.sourceAttribution,
      sourceUrl: item.sourceUrl,
      checksum: item.sourceChecksum,
    },
  };
}

export const CATALOG_LISTINGS: Listing[] = CATALOG_ITEMS.map(mapCatalogItem);
export const CATALOG_LISTING_COUNT = CATALOG_ITEM_COUNT;
export const DEMO_CATALOG_ID = 'demo-000027';

const listingById = new Map(CATALOG_LISTINGS.map((listing) => [listing.id, listing]));

export function findCatalogListing(listingId: string) {
  return listingById.get(listingId);
}

export function getCatalogCategoryId(listing: Listing) {
  return categoryIdBySource.get(listing.category) ?? 'other';
}

export function getCatalogListings(categoryId: CatalogCategoryId = 'all') {
  if (categoryId === 'all') return CATALOG_LISTINGS;
  return CATALOG_LISTINGS.filter((listing) => getCatalogCategoryId(listing) === categoryId);
}

export function searchCatalogListings(query = '', categoryId: CatalogCategoryId = 'all') {
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP');
  return getCatalogListings(categoryId).filter((listing) => {
    if (!normalizedQuery) return true;
    const haystack = [
      listing.title,
      listing.catalogTitle,
      listing.category,
      ...(listing.categoryPath ?? []),
      listing.subcategory,
      listing.brand,
      listing.color,
      listing.description,
      ...(listing.searchTags ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ja-JP');
    return haystack.includes(normalizedQuery);
  });
}

export function getCatalogCategories(): CatalogCategoryGroup[] {
  return categoryDefinitions.map((definition) => ({
    ...definition,
    count: definition.id === 'all' ? CATALOG_LISTINGS.length : getCatalogListings(definition.id).length,
  }));
}

export function getCatalogCounts() {
  return Object.fromEntries(getCatalogCategories().map((category) => [category.id, category.count])) as Record<CatalogCategoryId, number>;
}
