# Contributing to Tokuchu

Guidance for anyone, person or coding agent, working in this repository. The Next.js version notes that `next dev` writes to `AGENTS.md` apply as well.

Tokuchu is an event procurement system that uses attendee information and WebMCP-enabled Shopify
storefronts to coordinate personalized purchases for events. It is the agentic orchestration layer
over WebMCP tools on both ends: Shopify's commerce tools for discovery, the demo store's own
`get_customization` tool for a product's requirements, and its `add_customized_to_cart` tool, which
fills the store's cart and returns the checkout link. Tokuchu's records register as WebMCP tools on
the organizer's page. The project is built against one live demo store and is a submission to The
WebMCP Challenge (webmcp.devpost.com). The specification is `docs/prd.md`; the routing is
`docs/webmcp-routing.md`.

## Layout

The Next.js app sits at the repo root (`src/`, `tests/`, `integrations/`, `scripts/`, `docs/`). The
Shopify client is a local workspace at `packages/shopify-ucp`, consumed as `@webmcp/shopify-ucp` and
transpiled by Next. The merchant tools the store's theme loads live in `integrations/customily/`.

## Setup and tests

`npm run setup` installs dependencies, Playwright Chromium, and the pre-commit hooks, and checks the
`.env` key names. `npm test` runs vitest and `npm run typecheck` runs `tsc --noEmit` across the app
and `packages/shopify-ucp`; both must be green before a commit. Playwright suites run with
`npm run test:e2e`; the live suites and the recorded flow demo are gated by `LIVE_CUSTOMILY=1`.

## Environment

`.env` holds `OPENAI_API_KEY` (the curation agent), `CUSTOMILY_SHOP_URL` (the demo store), and the
four Shopify Admin API keys (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
`SHOPIFY_ADMIN_API_VERSION`). The deployment adds `DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`, and
`ORGANIZER_EMAILS`. Copy `.env.example` and fill it. Never read or print secret values; check a key's
presence by name.

## WebMCP

Invoke the `webmcp` skill before writing or reviewing any tool, in-page agent, or eval. It carries
the imperative and declarative API, the React hook, and the Chrome evals method. The store's pages
carry Shopify's own storefront WebMCP tools; a headless driver injects the polyfill before the page
scripts run so those tools and the merchant tools register.

## Style

Invoke the `house-style` skill before writing any human-facing text, the `commit-message` skill for
commits, and the `clean-code` skill for code. Every UI string is one clause with no comma. The
questions, choices, and variant options come from the store through `get_customization`, never a
hardcoded list.

## Tickets

Work is organized as GitHub issues in `reversely/tokuchu`, one ticket per commit directly to `main`,
no feature branches. The commit body ends with `closes #N`, and the subject follows Conventional
Commits. Verify the fast suite is green first.
