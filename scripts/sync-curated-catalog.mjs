import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const targetRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = resolve(process.env.BARGAIN_CATALOG_SOURCE ?? 'C:\\development\\メルカリUI_kit');
const sourceCatalog = join(sourceRoot, 'app', 'data', 'catalogData.ts');
const sourceImages = join(sourceRoot, 'public', 'images', 'products', 'pexels-selected');
const targetCatalogDir = join(targetRoot, 'src', 'lib', 'catalog');
const targetImageDir = join(targetRoot, 'public', 'images', 'products', 'pexels-selected');

mkdirSync(targetCatalogDir, { recursive: true });
mkdirSync(targetImageDir, { recursive: true });

const generatedCatalog = readFileSync(sourceCatalog, 'utf8').replace(
  "import type { MercariItem, ProductFamily, ProductVariant } from '../types/mercari';",
  "import type { MercariItem, ProductFamily, ProductVariant } from './types';",
);
writeFileSync(join(targetCatalogDir, 'catalogData.generated.ts'), generatedCatalog, 'utf8');

for (const filename of readdirSync(sourceImages)) {
  if (!/\.(?:jpe?g|json)$/i.test(filename)) continue;
  cpSync(join(sourceImages, filename), join(targetImageDir, filename));
}

console.log(`Synced catalog source from ${sourceRoot}`);
console.log(`Wrote ${join(targetCatalogDir, 'catalogData.generated.ts')}`);
console.log(`Copied ${readdirSync(targetImageDir).filter((filename) => /\.jpe?g$/i.test(filename)).length} product images`);
