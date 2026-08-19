# BARGAIN — Autonomous Negotiation Agent

BARGAIN is a Next.js sandbox for experimenting with buyer and seller agents that negotiate structured offers under deterministic policy constraints.

The application combines a LangGraph negotiation workflow, a 50-item curated catalog, policy guardrails, human approval tasks, contract drafts, and evaluation scenarios in one local demo.

## What is included

- Buyer and seller negotiation agents using LangGraph.
- Optional OpenAI or Google Gemini API providers with a deterministic fallback.
- Structured offer terms for price, quantity, tax, shipping, delivery, payment, and warranty.
- Policy validation that keeps LLM output inside buyer and seller constraints.
- Expandable negotiation history with safe decision metadata.
- Human approval queue for replies, contract drafts, and policy-boundary actions.
- Contract draft persistence with a development-only in-memory fallback and PostgreSQL schema.
- Seller console backed by the full 50-item catalog.
- Deterministic evaluation scenarios and operational metrics.

External email or chat delivery, electronic signatures, payments, and legally binding contracts are intentionally out of scope. Contract drafts require human review.

## Quick start

Use Node.js 22 or newer. Next.js 16 requires Node.js 20.9+, and the current
Wrangler toolchain requires Node.js 22+.

```powershell
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app works without an LLM key by using its built-in negotiation strategy. To enable a provider, set the corresponding values in `.env.local`. Never commit `.env.local` or any real API key.

## Cloudflare preview and deployment

The Worker bundle is built with OpenNext and deployed with Wrangler. Cloudflare
builds are most reliable on Linux or WSL; the OpenNext build may fail on native
Windows even when the Next.js build itself succeeds.

```powershell
npm run cf:typegen
npm run preview
```

If native Windows OpenNext bundling exits without a useful error, run the same
commands from WSL on the mounted project:

```bash
cd /mnt/c/development/AIエージェント
source ~/.nvm/nvm.sh
nvm use 24
npm ci
npm run cf:dry-run
```

Before staging or production deployment, create a Hyperdrive connection for the
corresponding PostgreSQL database and replace the two placeholder IDs in
`wrangler.jsonc`. Then configure secrets with `wrangler secret put` and run:

```powershell
npm run cf:dry-run
npm run deploy:staging
# after the staging smoke test
npm run deploy:production
```

The exact account, database, secret, authentication, domain, rollback, and
monitoring steps are in [docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md).

## Environment variables

See [.env.local.example](.env.local.example) for the available provider, model, PostgreSQL, and private-state encryption settings.

When `DATABASE_URL` is not configured, the application uses the in-memory store only outside production. Production fails closed until PostgreSQL and `BARGAIN_PRIVATE_STATE_KEY` are configured. Apply [docs/POSTGRES_SCHEMA.sql](docs/POSTGRES_SCHEMA.sql) before starting the app, and set `BARGAIN_SESSION_SECRET` for signed actor cookies. The current signed actor is a prototype boundary; a real identity provider is still required before an unrestricted public launch.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run audit
```

The test suite covers guardrails, structured terms, negotiation service contracts, catalog integrity, evaluation scenarios, agent alternatives, approval idempotency, and contract draft persistence.

## Project layout

```text
src/app/                 Next.js app and API routes
src/components/          UI screens and reusable components
src/lib/agent/           LangGraph workflow and agent strategy
src/lib/negotiation/     Policies, sessions, persistence, and workflow stores
src/lib/evaluation/      Deterministic evaluation scenarios
test/                    Unit, contract, evaluation, and demo tests
docs/                    Setup and PostgreSQL schema documentation
public/images/           Curated local product catalog images
```

Local browser logs, screenshots, Next.js build output, TypeScript caches, and environment files are excluded through `.gitignore`.
