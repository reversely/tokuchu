# Tokuchu

Tokuchu is an event procurement system that uses attendee information and WebMCP-enabled storefronts to coordinate personalized purchases for events. It acts as the agentic orchestration layer over WebMCP tools on both ends: Shopify's commerce tools for discovery, the demo store's own `get_customization` tool for the product's requirements, and the store's `add_customized_to_cart` tool, which fills the cart through Shopify's cart endpoint and returns the checkout link the organizer pays at. Tokuchu's own records register as WebMCP tools on the organizer's page. The project is built against one live demo store, deployed as a separate component, and is a submission to The WebMCP Challenge. The specification is `docs/prd.md` and the hop-by-hop routing is `docs/webmcp-routing.md`.

## What is in it

| Path | Role |
| --- | --- |
| `src/domain/` | records (`types.ts`), the store and change log (`store.ts`), value types (`values.ts`), the filter grammar (`filter.ts`), the gift (`gifts.ts`), field sources and resolution (`personalization.ts`) |
| `src/server/` | the operations behind the routes and the tools (`api.ts`), the shared catalog search (`search.ts`), the cart operations (`cart-api.ts`), the MCP endpoint with tokens (`mcp.ts`), the Admin API client (`shopify-admin.ts`) |
| `src/agent/` | catalog search, delivery probe, and ranking (`search.ts`), the cart at the store (`cart.ts`), the curation agent (`curation-agent.ts`) |
| `src/webmcp/` | the tool definitions as data mapped to routes (`tools.ts`), registration on `document.modelContext` (`register.ts`), the polyfill |
| `src/app/` | sign-in, the draft page, the invite form, the dashboard (Overview, Guest Experience, Attendees), and the API routes |
| `packages/shopify-ucp/` | the client for the Global Catalog and a store's UCP endpoint, as a local workspace |
| `integrations/customily/` | the merchant WebMCP tools the store's theme loads, with installation notes |
| `tests/` | Playwright: draft, invite, overview, experience, the tools through the polyfill, and the live flow demo |

## Running

From the repo root:

```sh
npm run setup                          # install, Playwright Chromium, hooks, .env check
npm run dev                            # http://localhost:3113
npm test                               # vitest (LIVE_SHOPIFY=1 adds the live catalog and cart tests)
npm run typecheck
npm run test:e2e                       # the Playwright suites except the live demo
LIVE_CUSTOMILY=1 npm run test:flow-demo  # the recorded flow demo against the live store
```

The demo store sells a customizable crewneck. Its product page carries Shopify's storefront WebMCP tools and the two merchant tools. The flow demo opens the checkout link it records in a fresh browser and asserts one line per attendee.

## Deployment

The app deploys on Render as a Web Service built from the Dockerfile, with Render Postgres holding one JSON document per event and the sign-in tables. Sign-in uses a magic link sent through Resend to an address on the `ORGANIZER_EMAILS` allowlist; a dev server without `RESEND_API_KEY` logs the link to its console instead. Attendee requests and follow-ups go out through the same Resend key in production or with `MAIL_LIVE=1`, and the links in them point at `APP_URL`; any other server logs one line per message. The environment names are listed in `.env.example`.
