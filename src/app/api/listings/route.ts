import { NextRequest, NextResponse } from 'next/server';
import { searchCatalogListings, type CatalogCategoryId } from '@/lib/catalog/catalogAdapter';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const category = (request.nextUrl.searchParams.get('category')?.trim() || 'all') as CatalogCategoryId;
  const listings = searchCatalogListings(query, category);
  return NextResponse.json({ listings });
}
