export interface Seller {
  name: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  level?: number;
  completedSales?: number;
  responseRate?: number;
}

export interface ProductFamily {
  id: string;
  name: string;
  productType: string;
  category: string;
}

export interface ProductVariant {
  id: string;
  familyId: string;
  name: string;
  attributes: Record<string, string>;
  searchTags: string[];
}

/**
 * Local compatibility shape for the generated catalog. The generated rows
 * carry more marketplace fields than the negotiation demo needs.
 */
export interface CatalogSourceItem {
  id: string;
  sku?: string;
  title: string;
  price: number;
  images: string[];
  description: string;
  category: string[];
  condition: string;
  likesCount: number;
  viewsCount?: number;
  seller: Seller;
  comments: unknown[];
  isSold?: boolean;
  isAuction?: boolean;
  currentBid?: number;
  bidsCount?: number;
  timeLeft?: string;
  brand?: string;
  size?: string;
  color?: string;
  shippingFee?: string;
  shippingMethod?: string;
  origin?: string;
  shippingDays?: string;
  shippingSize?: string;
  productFamilyId?: string;
  productFamilyName?: string;
  variantId?: string;
  variantName?: string;
  productType?: string;
  searchTags?: string[];
  attributes?: Record<string, string>;
  sellerType?: 'individual' | 'shop';
  inventoryPolicy?: 'SINGLE' | 'MULTI';
  inventoryInitialQuantity?: number;
  inventoryQuantity?: number;
  reservedQuantity?: number;
  listingStatus?: string;
  isDemo?: boolean;
  sourceUrl?: string;
  sourcePhotographer?: string;
  sourceAttribution?: string;
  sourceChecksum?: string;
  [key: string]: unknown;
}
