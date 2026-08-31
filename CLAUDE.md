# CLAUDE.md

Guidance for Claude Code working in the Tokuchu repository.

Tokuchu turns an event's attendance and each attendee's personalization data into orders at
WebMCP-enabled Shopify stores. The store defines the survey: the app reads a product's
personalization schema through WebMCP and asks attendees only the fields their items need. The
specification is `docs/prd.md`.

## Layout

The Next.js app sits at the repo root (`src/`, `tests/`, `integrations/`, `scripts/`, `docs/`). The
Shopify agent client is a local workspace at `packages/shopify-ucp`, consumed as
`@webmcp/shopify-ucp` and transpiled by Next. The print shop is an external vendor reached at
`PRINTSHOP_URL`; it runs in the WebMCP sandbox for now.

## Setup and tests

`npm run setup` installs dependencies, Playwright Chromium, and the pre-commit hooks, and checks the
`.env` key names. `npm test` runs vitest and `npm run typecheck` runs `tsc --noEmit` across the app
and `packages/shopify-ucp`; both must be green before a commit. Playwright suites run with
`npm run test:e2e`; the live Customily suites and the recorded demo are gated by `LIVE_CUSTOMILY=1`.

## Environment

`.env` holds `OPENAI_API_KEY` (the curation agent), `CUSTOMILY_SHOP_URL` (the custom shop the
discovery source lists), and `PRINTSHOP_URL` (the print-shop vendor). Copy `.env.example` and fill
it. Never read or print secret values; check a key's presence by name.

## WebMCP

Invoke the `webmcp` skill before writing or reviewing any tool, in-page agent, or eval. It carries
the imperative and declarative API, the React hook, and the Chrome evals method.

## Style

Invoke the `house-style` skill before writing any human-facing text, the `commit-message` skill for
commits, and the `clean-code` skill for code. Every UI string is one clause with no comma. The
survey questions, choices, and variant options come from the store through WebMCP, never a hardcoded
library.

## Tickets

Work is organized as GitHub issues in `reversely/tokuchu`, one ticket per commit directly to `main`,
no feature branches. The commit body ends with `closes #N`, and the subject follows Conventional
Commits. Verify the fast suite is green first.

@AGENTS.md
