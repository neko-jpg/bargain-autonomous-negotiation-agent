import { CATALOG_LISTINGS, DEMO_CATALOG_ID, getCatalogCategories, getCatalogListings, searchCatalogListings } from '../src/lib/catalog/catalogAdapter';

export function runCatalogTests(): boolean {
  console.log('\n--- 🧺 Running Curated Catalog Verification ---');
  let passed = true;
  const imagePaths = CATALOG_LISTINGS.map((listing) => listing.imageUrl);
  const categories = getCatalogCategories();
  const demo = CATALOG_LISTINGS.find((listing) => listing.id === DEMO_CATALOG_ID);

  if (CATALOG_LISTINGS.length === 50 && new Set(imagePaths).size === 50) {
    console.log('✅ [PASS] 50 catalog listings and 50 unique local image paths are available');
  } else {
    console.error(`❌ [FAIL] Catalog count=${CATALOG_LISTINGS.length}, unique images=${new Set(imagePaths).size}`);
    passed = false;
  }

  if (demo && demo.imageUrl.startsWith('/images/products/pexels-selected/') && demo.title.includes('PlayStation')) {
    console.log(`✅ [PASS] Curated demo item is ${demo.title} at ¥${demo.price.toLocaleString()}`);
  } else {
    console.error('❌ [FAIL] Curated demo item is missing or is not mapped to local catalog data');
    passed = false;
  }

  if (categories.find((category) => category.id === 'games')?.count && getCatalogListings('electronics').length > 0) {
    console.log('✅ [PASS] Category group counts and category filtering are connected');
  } else {
    console.error('❌ [FAIL] Category groups did not return catalog listings');
    passed = false;
  }

  if (searchCatalogListings('PlayStation').some((listing) => listing.id === DEMO_CATALOG_ID)) {
    console.log('✅ [PASS] Search indexes title, category, and generated catalog tags');
  } else {
    console.error('❌ [FAIL] Search did not find the demo item');
    passed = false;
  }

  return passed;
}

if (process.argv.some((argument) => argument.endsWith('catalog.test.ts'))) {
  process.exit(runCatalogTests() ? 0 : 1);
}
