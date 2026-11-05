import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const targetRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configuredSource = process.env.BARGAIN_CATALOG_SOURCE?.trim();
if (!configuredSource) {
  console.error('BARGAIN_CATALOG_SOURCE is required: path to the source catalog project.');
  process.exit(1);
}
const sourceRoot = resolve(configuredSource);
const sourceCatalog = join(sourceRoot, 'app', 'data', 'catalogData.ts');
const sourceImages = join(sourceRoot, 'public', 'images', 'products', 'pexels-selected');
const targetCatalogDir = join(targetRoot, 'src', 'lib', 'catalog');
const targetImageDir = join(targetRoot, 'public', 'images', 'products', 'pexels-selected');

mkdirSync(targetCatalogDir, { recursive: true });
mkdirSync(targetImageDir, { recursive: true });

// The source project declares its own item type. The generated file keeps the
// data shape but rewrites that import and the type name to this repository's.
const generatedCatalog = readFileSync(sourceCatalog, 'utf8')
  .replace(
    /import type \{[^}]*\} from '\.\.\/types\/[^']+';/,
    "import type { CatalogSourceItem, ProductFamily, ProductVariant } from './types';",
  )
  .replace(/\bMercariItem\b/g, 'CatalogSourceItem');
writeFileSync(join(targetCatalogDir, 'catalogData.generated.ts'), generatedCatalog, 'utf8');

for (const filename of readdirSync(sourceImages)) {
  if (!/\.(?:jpe?g|json)$/i.test(filename)) continue;
  cpSync(join(sourceImages, filename), join(targetImageDir, filename));
}

console.log(`Synced catalog source from ${sourceRoot}`);
console.log(`Wrote ${join(targetCatalogDir, 'catalogData.generated.ts')}`);
console.log(`Copied ${readdirSync(targetImageDir).filter((filename) => /\.jpe?g$/i.test(filename)).length} product images`);
