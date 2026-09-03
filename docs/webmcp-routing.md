# WebMCP routing

How a personalized order travels from the organizer's sentence to the store's checkout, and which WebMCP tool carries each hop. Every entry names a real endpoint or a registered tool.

## The two ends

Tokuchu is the organizer's app. The store is a Shopify storefront that speaks WebMCP. Each end publishes tools, and an agent bridges them.

**The store's end** has three surfaces:

- The UCP endpoint at `https://{shop}/api/ucp/mcp`, which answers Shopify's commerce tools as JSON-RPC from a server (`packages/shopify-ucp/src/client.ts`).
- Shopify's page tools, registered on `document.modelContext` by Shopify's storefront script on every page: search, product, cart, and checkout navigation.
- The merchant tools in the theme (`integrations/customily/webmcp-customily.js`): `get_customization` and `add_customized_to_cart`.

**Tokuchu's end** registers the event's records as tools on the organizer's page (`src/webmcp/register.ts`, definitions in `src/webmcp/tools.ts`), registers `submit_rsvp` on the invite page, and serves the organizer list over JSON-RPC at `/api/events/{id}/mcp` to a token holder.

## The hops in order

| Hop | Who calls | Tool | Where it registers | Transport |
| --- | --- | --- | --- | --- |
| 1. Search the catalog | Tokuchu's server | `search_catalog`, `lookup_catalog`, `get_product` | Shopify's UCP endpoint and the Global Catalog | JSON-RPC over HTTP with Tokuchu's agent profile |
| 2. Read the requirements | Tokuchu's server in a headless store page | `get_customization` | the store's page, merchant tool | WebMCP `executeTool`, once per product when the search lists the custom shop and again when the organizer confirms the pick |
| 3. Request the missing values | the organizer's page, or a browser agent on it | `get_requirements`, `request_from_attendees`, `follow_up` | Tokuchu's dashboard page | WebMCP `executeTool`, mapped to `GET` and `POST /api/events/{id}/gifts/{giftId}/request-fields` and `POST /api/events/{id}/gifts/{giftId}/follow-up`; the Attendees tab's buttons run the same tool definitions through `executeThroughApi` |
| 4. Answer | the attendee's invite page, or the attendee's agent on it | `submit_rsvp` | Tokuchu's invite page | WebMCP `executeTool`, mapped to `POST /api/events/{id}/rsvp` for a first reply and `PATCH /api/events/{id}/rsvp/{guestId}` for an edit; the form's button runs the same `sendRsvp` call. The tool's schema lists one property per question the attendee is asked with the store's `maxLength`, `enum`, `format`, and `pattern` |
| 5. Approve and fill the cart | the organizer's page, or a browser agent on it, then Tokuchu's server in a headless store page | `approve_specs`, then `add_customized_to_cart` | Tokuchu's dashboard page, then the store's page | WebMCP `executeTool` mapped to `POST /api/events/{id}/gifts/{giftId}/approve-specs`, which records the approval and starts the cart job; the job calls `add_customized_to_cart` with `executeTool` on the store page |
| 6. Review and pay | the organizer in a browser | the cart's `checkoutUrl` | Shopify's checkout | the URL the cart tool returned |
| 7. Read the order | Tokuchu's server | GraphQL Admin API (`src/server/shopify-admin.ts`) | Shopify Admin | HTTPS with a client-credentials token |

Hops 2, 3, 4, and 5 run over WebMCP tools; the Attendees tab's approve button runs the `approve_specs` definition through `executeThroughApi` as its request buttons do. Hop 1 runs over HTTP because the Global Catalog exists only at its endpoint; the store's own page tool `search_catalog` covers one store and Tokuchu's search spans many. Hop 7 runs after checkout, where Shopify exposes orders through the Admin API alone.

## The procurement tools

A store's agent holds a token (`POST /api/events/{id}/tokens`) that names the gifts it may read and the definitions it may see. The gift is the procurement until a Procurement record exists, so each tool takes `procurement_id` or `gift_id` for the same record. Every procurement-visible write appends one change-log entry with `actor_type`, the attendee and requirement it concerns, and a one-line summary; the gift's `current_revision` is the seq of the last entry the caller may see.

| Tool | Who calls | Route | What it returns |
| --- | --- | --- | --- |
| `get_changes` | the organizer's page, or a token holder over JSON-RPC | `GET /api/events/{id}/changes?gift={giftId}&after={revision}` | `{ procurement_id, from_revision, current_revision, changes[] }`; each change carries `revision`, `timestamp`, `actor_type`, `actor_id?`, `type`, `attendee_ref?`, `requirement_id?`, `summary`. A token holder sees a value write only for a definition the gift maps and the token may read. Without a gift the call keeps its earlier form: `?since={seq}` returns the event's whole change log |

## The bridge

The merchant tools and Shopify's page tools exist only on the store's pages. Tokuchu's server opens a page of the store in a headless browser (`src/server/store-page.ts`), injects the WebMCP polyfill before the page scripts run so that both Shopify's script and the theme asset register their tools, waits for `getTools()` to list them, and calls them with `executeTool`.js` beside the polyfill. The cart the tools build belongs to that browser session. The `checkoutUrl` the cart tool returns, `/cart/c/{token}?key=...`, opens the same cart at Shopify's checkout in any browser, which is how the cart leaves the session and reaches the organizer.

The optional curation run (`POST /api/events/{id}/curate`) wraps hops 1 and 2 in an agent whose tool steps stream to the dashboard.
