# Tokuchu

Event organizers often request customizations, from dietary restrictions to names printed on party favours. The difficult part is collecting the specifications: the organizer may not yet know who is attending, what each guest needs, or which details a vendor requires. That uncertainty creates manual back and forth among the guest list, the storefront, and the vendor.

Agents can coordinate this information when there is an intermediate source of truth that can both consume requirements from an e-commerce site and expose the resulting fulfilment data back to authorized agents through WebMCP.

## Two sister websites

Tokuchu explores that model through a pair of websites. Both expose custom WebMCP functions, allowing agents on either side of a purchase to work against the same evolving order state.

| Tokuchu: RSVP Application with Attendee States | Customworks: Shopify Store with WebMCP-enabled Customization |
| --- | --- |
| ![Tokuchu — personalize gifts for your attendee list using WebMCP agents](public/media/tokuchu-banner.webp) | ![Customworks — a Shopify storefront for the WebMCP Challenge](public/media/customworks-banner.webp) |
| Tokuchu owns the event, RSVP data, missing-information workflow, approval revision, and scoped fulfilment record. | Customworks owns products, personalization constraints, variants, configured cart lines, checkout, and order status. |

Tokuchu can consume WebMCP requirements from a storefront, reconcile them against attendee information it already holds, request only what is missing, and expose a permission-limited fulfilment view back to the vendor. Customworks uses WebMCP to describe what each product needs, accept configured items, and return updates about the resulting order.

## A product procurement in practice

An organizer uses Shopify's Global Catalog to find a suitable customized product and arrives at Customworks. The product's `get_customization` function tells the agent which recipient values it requires and the constraints each value must satisfy.

Tokuchu compares that product contract against the event's RSVP data. Requirements already present in attendee or event records are mapped directly. Requirements that are not present become new attendee fields, and Tokuchu requests them only from the relevant participants through `submit_rsvp`.

When the responses return, Tokuchu validates them and assembles a fulfilment manifest containing only the information this procurement needs. The organizer reviews and approves that exact revision. An agent can then pass the ready cart items to Customworks through `add_customized_to_cart` and continue through Shopify checkout.

The store can also receive scoped access to the procurement. Its agent reads the approved manifest through `get_fulfillment_manifest` without seeing unrelated RSVP information. If a submitted value cannot be fulfilled, it sends a structured clarification through `post_procurement_update`. Tokuchu records the exception, routes it back to the affected attendee, and exposes the corrected value in the next revision through `get_changes`.

Throughout the flow, Tokuchu both consumes WebMCP from the storefront and exposes WebMCP to authorized agents. The result is a shared source of truth: vendor requirements are reconciled against known attendee data, missing values are collected only when necessary, and each party sees only what it needs to move the order forward.

## The flow

[Open the rendered architecture and Stagehand flow](https://tokuchu.onrender.com/docs/architecture).

### From attendee records to configured checkout

| Tokuchu — attendee and procurement records | Customworks — product and checkout |
| --- | --- |
| ![Tokuchu attendee records and requested product fields](docs/media/guide/13-records-grid.png) | ![Customworks checkout with one personalized line per attendee](docs/media/guide/16-store-cart.png) |

The attendee records on the left become configured cart lines on the right. Tokuchu never owns product truth or payment; Customworks never owns the RSVP list or approval history.

## The utility hierarchy

The many WebMCP calls serve four larger utilities. These are the stable product concepts; tool names are implementation details beneath them.

### 1. Plan a suitable gift — for the organizer

Tokuchu helps the organizer find a product that fits the event, budget, recipient rules, and delivery destination. Customworks then describes exactly how that product may be configured. The result is a gift plan with a versioned product requirement contract.

This utility includes catalog search, product lookup, delivery checks, recipient assignment rules, variant discovery, and customization-field discovery.

### 2. Make every recipient ready — for the organizer and attendees

Tokuchu compares the product contract with information already present in the event and RSVP records. It maps reusable values such as attendee name or event location automatically, creates questions only for unresolved requirements, and asks only the affected attendees. Each attendee gets one RSVP utility for answering or correcting their own values.

This utility includes RSVP submission, requirement mapping, missing-answer detection, request and follow-up email, constraint validation, and reconciliation into one readiness row per recipient.

### 3. Approve and prepare the order — for the organizer

When every required row is ready, Tokuchu freezes the organizer's decision at a revision and produces a fulfilment manifest. Customworks validates that batch against the product contract, creates one personalized cart line per recipient, and returns the Shopify checkout. Tokuchu records the checkout without becoming the payment system.

This utility includes manifest generation, revision-aware approval, cart preparation, rejected-line reporting, checkout creation, and order-status retrieval.

### 4. Collaborate on fulfilment — for the store and affected attendees

After approval, the organizer gives the store a signed, permission-limited Tokuchu link. The store can read only the approved procurement data it needs, acknowledge revisions, report production or fulfilment, and raise a structured exception. An exception tied to a recipient requirement reopens that question for the attendee; their correction returns through Tokuchu's change log to the store.

This utility includes scoped data sharing, progress updates, exceptions, attendee correction, revision history, and acknowledgement.

## How the utilities run

The four utilities above are the product. The runtime mode only decides who performs the cross-site handoffs.

| Mode | Experience | Boundary crossing |
| --- | --- | --- |
| **Managed mode** (default) | The organizer works in Tokuchu as a conventional application | Tokuchu's server searches Shopify, reads supported product pages, and prepares the store cart after approval |
| **Agent handoff mode** (`TOKUCHU_STATIC=1`) | An agent works across an event tab and a product tab | The agent carries the product contract, approved cart items, and checkout reference between the two sites |

In both modes, attendees still answer through Tokuchu and the store still collaborates through a scoped Tokuchu grant. “Static” means only that Tokuchu avoids outbound store automation; its records and APIs remain live and mutable.

### Managed mode

Tokuchu runs all four utilities behind the organizer interface. During planning it searches Shopify, loads product detail, checks delivery, and reads supported customization contracts. During order preparation it builds the approved recipient batch, opens the merchant page or Shopify UCP cart, and records the resulting checkout. Cart preparation runs asynchronously so the dashboard can show progress and blocked rows.

### Agent handoff mode

The same four utilities remain intact, but a browser or terminal agent performs the two store crossings:

| Product phase | What the agent accomplishes | Data handed across |
| --- | --- | --- |
| Plan a suitable gift | Reads the store's product contract and establishes the gift in Tokuchu | Fields, constraints, variants, product identity |
| Make every recipient ready | Works inside Tokuchu while attendees supply missing values | No store handoff |
| Approve and prepare | Takes Tokuchu's approved recipient batch to the store and records the result | Cart items → store; checkout URL → Tokuchu |
| Collaborate on fulfilment | Opens the store's scoped Tokuchu view | Approved manifest, changes, updates, exceptions |

The detailed calls are discoverable from each page's WebMCP schemas. The event, invite, and store handoff pages also include Agent notes and a `tokuchu-agent-task` meta tag that state the next purpose-level action.

### Running the demo

`npm run agent-run -- "<goal>"` is the primary way to run this mode. `scripts/agent-run.mjs` launches local Chrome through Stagehand, creates Stagehand around that browser, and gives its shared browser context to the OpenAI Agents SDK runtime in `src/agent/agent-run.ts`. The model receives five generic controls: `open_page`, `list_webmcp_tools`, `call_webmcp_tool`, `switch_tab`, and `record_checkout`. It does not receive a hard-coded list of product operations.

For each tab, `list_webmcp_tools` calls Stagehand's `Page.tools()` and returns the native WebMCP registrations on `document.modelContext`, including name, description, input schema, and frame ID. `call_webmcp_tool` resolves the selected registration, invokes it with structured input, waits for the result, and normalizes WebMCP content and errors. The runtime captures a returned checkout URL without exposing it to the model; `record_checkout` uses that captured value to call Tokuchu's `post_update`. Every model decision, browser call, result, and final outcome is written to `tests/videos/agent-run-*.json`.

With `TOKUCHU_STATIC=1`, Tokuchu omits server-side store actions, so this Stagehand-controlled browser is the bridge between Tokuchu and Customworks. `docs/agent-runtime.md` supplies the operating rules and purpose-level sequence. `npm run agent-playbook` is the deterministic fallback: Playwright follows a fixed sequence through the WebMCP polyfill and needs no model. Both paths need a static server on port 3114 and network access to the demo store; the Stagehand run also needs `OPENAI_API_KEY`.

## Store handoff flow

The store handoff belongs to the fourth utility, **Collaborate on fulfilment**. It is a separate phase after cart preparation—not the Customworks product page used to describe or configure the gift.

The organizer creates an access grant and sends its signed `/s/{token}` link to the store. The link opens `/store/{grantId}`, where Tokuchu registers only the tools permitted by that grant.

![The store-facing Tokuchu page showing the approved fulfilment manifest and its revision](docs/media/guide/18-store-manifest.png)

The store uses that single workspace to understand the approved order, report where production stands, and resolve anything it cannot fulfil. Read access, change tracking, and write access are separate permissions:

| Permission | Tools |
| --- | --- |
| `manifest:read` | `get_procurement`, `get_manifest`, `get_fulfillment_manifest` |
| `requirements:read` | `get_requirements` |
| `changes:read` | `get_changes`, `acknowledge_changes` |
| `updates:read` | `get_updates` |
| `updates:write` | `post_update`, `post_procurement_update` |

The MCP endpoint reads the grant again on every call. Revocation or expiry therefore takes effect immediately. Gift access and readable attendee attributes are filtered server-side, not only hidden in the page.

## Capability map and underlying tools

Most readers can stop at the four utilities. This table maps those concepts to the lower-level WebMCP operations for implementers and agent authors.

| Utility | Primary user | Tokuchu capabilities | Store capabilities |
| --- | --- | --- | --- |
| **Plan a suitable gift** | Organizer | Understand the audience, search, define recipient rules, and store the product contract (`get_guest`, `list_guests`, `count_by`, `get_summary`, `search_gifts`, `set_gift_plan`, `set_gift_customization`) | Discover products and declare configuration rules (`search_catalog`, `lookup_catalog`, `get_product`, `get_customization`) |
| **Make every recipient ready** | Organizer + attendee | Map existing data, identify gaps, ask, validate, and reconcile (`set_personalization_mapping`, `get_requirements`, `request_from_attendees`, `follow_up`, `list_missing`, `submit_rsvp`, `get_manifest`) | Supply the field constraints Tokuchu enforces (`get_customization`) |
| **Approve and prepare the order** | Organizer | Build the fulfilment view, approve a revision, and record progress (`get_fulfillment_manifest`, `approve_specs`, `send_to_vendor`, `approve`, `post_update`) | Validate configured items, prepare checkout, and report the resulting order (`add_customized_to_cart`, `create_cart`, `update_cart`, `get_cart`, `create_checkout`, `get_order`, `get_order_updates`) |
| **Collaborate on fulfilment** | Store + organizer + affected attendee | Share a scoped procurement, track revisions, and route exceptions (`get_procurement`, `get_fulfillment_manifest`, `get_updates`, `post_procurement_update`, `get_changes`, `acknowledge_changes`, `submit_rsvp`) | Report acceptance, production, fulfilment, or a recipient-specific problem through the Tokuchu grant |

The invite page exposes only `submit_rsvp`, with a schema generated from the questions relevant to that attendee. The store handoff page exposes only the tools its grant permits. The organizer event page exposes the broader planning and coordination surface.

The Customworks adapter lives under `integrations/customily/`; the typed Shopify JSON-RPC client lives under `packages/shopify-ucp/`. Every Shopify call includes the public UCP agent profile in `arguments.meta["ucp-agent"].profile` and requires no private API key.

## Application structure

| Path | Role |
| --- | --- |
| `src/domain/` | Event, guest, gift, value, requirement, reconciliation, procurement, and change-log rules |
| `src/server/` | API operations, persistence, auth, grants, MCP dispatch, search, cart jobs, manifests, exceptions, mail, and tracing |
| `src/agent/` | Stagehand browser-agent runtime plus catalog search, delivery checking, ranking, cart operations, and optional curation agent |
| `src/webmcp/` | Central tool definitions, page registration, route mapping, agent task text, and polyfill |
| `src/app/` | Next.js pages and API routes for organizers, attendees, demos, and store grants |
| `packages/shopify-ucp/` | Typed JSON-RPC client for Shopify Global Catalog and storefront UCP endpoints |
| `integrations/customily/` | The demo merchant's product-page WebMCP adapter |
| `src/demo/` | Seeded event and guided tour state |
| `tests/` | Browser coverage for the UI, WebMCP surfaces, static agent flow, and two-sided acceptance flow |

The central tool catalog is `src/webmcp/tools.ts`. Browser registration is in `src/webmcp/register.ts`, and token-authenticated JSON-RPC dispatch is in `src/server/mcp.ts`.

## Running locally

```sh
npm run setup
npm run dev                              # managed mode at http://localhost:3113
npm test
npm run typecheck
npm run test:e2e
```

Agent handoff mode:

```sh
TOKUCHU_STATIC=1 npm run dev -- -p 3114
npm run test:static
npm run agent-run -- "Order the crewneck for every attendee going and report the checkout link."
npm run agent-playbook                   # the deterministic fallback with Playwright
```

Live-store suites:

```sh
LIVE_CUSTOMILY=1 npm run test:flow-demo
LIVE_CUSTOMILY=1 npx playwright test tests/acceptance.spec.ts
```

`LLM_ENABLED=1` enables the optional curation agent and chat panel in managed mode. It remains off in agent handoff mode. Without `DATABASE_URL`, local development stores events in memory and treats an unauthenticated request as the local organizer.

## Documentation map

- `docs/prd.md` — product requirements and domain behavior
- `docs/webmcp-routing.md` — tool-to-route mapping and hop-by-hop transport details
- `docs/guide.md` — organizer-facing walkthrough
- `docs/agent-playbook.md` — instructions and error handling for an agent driving both pages
- `docs/diagrams/agent-sequence.mmd` — agent handoff sequence source
- `docs/diagrams/store-sequence.mmd` — store grant sequence source

## Deployment

The production target is a Render Web Service backed by Render Postgres. The Docker image uses Microsoft's Playwright base image so the bundled Chromium matches the installed Playwright version. Each deploy runs the database migration before starting the standalone Next.js server.

Required deployment configuration is documented in `.env.example`. The principal external values are the database URL, authentication secret and URL, Resend configuration, organizer allowlist, optional OpenAI key, demo store URL, and Shopify Admin credentials used to install or refresh the theme adapter.

Authentication uses email magic links through Resend. Without a mail key, development logs the link to the console. Demo guests can create an account to retain their event. Attendee requests and correction emails use the same mail system and link back to the appropriate invite record.

To install or refresh the demo store's merchant adapter through the Shopify Admin API:

```sh
node --env-file=.env --import tsx scripts/install-theme-adapter.ts
```

Use `--dry-run` to inspect the theme change without writing it.
