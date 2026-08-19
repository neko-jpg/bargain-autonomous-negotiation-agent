/**
 * Keep deployment-mode checks in one place. Cloudflare runtime variables are
 * available through process.env in OpenNext, while Next.js uses NODE_ENV for
 * local builds and the standard Node runtime.
 */
export function isProductionEnvironment() {
  // BARGAIN_ENV is the explicit deployment mode used by Wrangler. It must
  // override the production NODE_ENV used by a locally previewed OpenNext
  // bundle; otherwise local Worker preview would accidentally disable demos
  // and require production-only infrastructure.
  return process.env.BARGAIN_ENV
    ? process.env.BARGAIN_ENV === 'production'
    : process.env.NODE_ENV === 'production';
}

export function areDemoHeadersEnabled() {
  return !isProductionEnvironment() && String(process.env.BARGAIN_ENABLE_DEMO_HEADERS) === 'true';
}
