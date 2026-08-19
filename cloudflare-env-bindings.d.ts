/**
 * Minimal binding types kept separate from Wrangler's generated environment
 * types so Cloudflare runtime DOM declarations do not replace Next.js's DOM
 * types during the normal application typecheck.
 */
interface Hyperdrive {
  connectionString: string;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
