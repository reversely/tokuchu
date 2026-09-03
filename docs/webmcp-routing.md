# WebMCP routing

How a personalized order travels from the organizer's sentence to the store's checkout, and which WebMCP tool carries each hop. Every entry names a real endpoint or a registered tool.

## The two ends

Tokuchu is the organizer's app. The store is a Shopify storefront that speaks WebMCP. Each end publishes tools, and an agent bridges them.

**The store's end** has three surfaces:

- The UCP endpoint at `https://{shop}/api/ucp/mcp`, which answers Shopify's commerce tools as JSON-RPC from a server (`packages/shopify-ucp/src/client.ts`).
- Shopify's page tools, registered on `document.modelContext` by Shopify's storefront script on every page: search, product, cart, and checkout navigation.
- The merchant tools in the theme (`integrations/customily/webmcp-customily.js`): `get_customization` and `add_customized_to_cart`.

**Tokuchu's end** registers the event's records as tools on the organizer's page (`src/webmcp/register.ts`, definitions in `src/webmcp/tools.ts`), registers `submit_rsvp` on the invite page, registers the store-scoped tools on the store-facing page, and serves the tool list over JSON-RPC at `/api/events/{id}/mcp` to a token holder.

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

A store's agent holds a token that names the gifts it may read and the definitions it may see. The organizer mints one directly (`POST /api/events/{id}/tokens`) or through an AccessGrant (`POST /api/events/{id}/grants`, `src/server/grants.ts`): the grant names the grantee (`user`, `vendor`, or `agent`), one procurement, its permissions (`manifest:read`, `requirements:read`, `changes:read`, `updates:read`, `updates:write`), and optionally the definition ids the holder may read. A token minted from a grant takes its scope from the grant on every call at `/api/events/{id}/mcp`: a revoked grant (`DELETE /api/events/{id}/grants/{grantId}`), an expired grant, and a grant a `fulfilled` update expired each answer with an error and nothing else. The gift is the procurement until a Procurement record exists, so each tool takes `procurement_id` or `gift_id` for the same record. Every procurement-visible write appends one change-log entry with `actor_type`, the attendee and requirement it concerns, and a one-line summary; the gift's `current_revision` is the seq of the last entry the caller may see.

| Tool | Who calls | Route | What it returns |
| --- | --- | --- | --- |
| `get_procurement` | the organizer's page, the store's page, or a token holder over JSON-RPC | `GET /api/events/{id}/gifts/{giftId}/procurement` | `{ procurement_id, product: { id, title, url }, store, status, current_revision, approved_revision, requirement_schema_id?, attendees, open_exceptions }`; the revision and the exception count follow what the caller may read |
| `get_requirements` | the organizer's page, the store's page, or a token holder over JSON-RPC | `GET /api/events/{id}/gifts/{giftId}/request-fields` | `{ requirements[] }` with the source that fills each; a token holder sees a requirement only when it names no definition or one the token may read |
| `get_fulfillment_manifest` | the organizer's page, the store's page, or a token holder over JSON-RPC | `GET /api/events/{id}/gifts/{giftId}/fulfillment` | `{ procurement_id, revision, approved_revision, requirement_schema_id?, status, attendees[] }`; each attendee carries `attendee_ref`, `status` (ready, incomplete, invalid, or exception), `variant_id`, `values` keyed by the store's requirement key, and `issues[]` with `requirement_id`, `status`, `message`. A token holder sees a value and its issues only for a requirement whose definition the token may read; the organizer sees every requirement. `get_manifest` keeps its row shape for the page |
| `post_procurement_update` | a token holder over JSON-RPC, or the organizer's page | `POST /api/events/{id}/gifts/{giftId}/procurement-updates` | `{ update, exception, procurement_status, current_revision }`. `accepted`, `production_started`, and `fulfilled` set the gift's `procurement_status`. `needs_information`, `invalid_value`, `option_unavailable`, and `exception` open a `ProcurementException` (in the snapshot's `exceptions` and on the manifest row as `incomplete` or `vendor_rejected`); one that names an attendee's requirement records a request and emails the attendee a correction through the attendee's own link with the store's message quoted, and the attendee's next answer on that requirement resolves it with `resolved_revision`. Every update also posts into the progress log, so `post_update` and `get_updates` keep working |
| `get_changes` | the organizer's page, or a token holder over JSON-RPC | `GET /api/events/{id}/changes?gift={giftId}&after={revision}` | `{ procurement_id, from_revision, current_revision, changes[] }`; each change carries `revision`, `timestamp`, `actor_type`, `actor_id?`, `type`, `attendee_ref?`, `requirement_id?`, `summary`. A token holder sees a value write only for a definition the gift maps and the token may read. Without a gift the call keeps its earlier form: `?since={seq}` returns the event's whole change log |

## The store's side

The organizer's grant answers with a signed link, `/s/{token}` (`src/server/store-session.ts`): the event, the grant, and the link's expiry signed with `AUTH_SECRET` the way the demo guest's id is. Opening the link sets the `tokuchu_store` cookie and lands on `/store/{grantId}` (`src/app/store/[grantId]`), which reads the grant again on every render and shows the Procurement summary, the manifest rows and requirements the grant allows, the open exceptions, the updates posted, and a form that posts a structured update. No store account stands behind the page; a revoked or expired grant renders the not-found page.

The store page registers the grant's tools on `document.modelContext` through `registerStoreTools` (`src/webmcp/register.ts`): each vendor-scope tool the grant's permissions allow, bound to `POST /api/events/{id}/mcp` with the grant's token as the bearer, so an agent on the store's side and the page's own form run one path and the change log records the store as the actor. The registration reflects the grant: `manifest:read` registers `get_procurement`, `get_manifest`, and `get_fulfillment_manifest`; `requirements:read` registers `get_requirements`; `changes:read` registers `get_changes`; `updates:read` registers `get_updates`; `updates:write` registers `post_update` and `post_procurement_update`. A permission the grant lacks registers no tool, and an organizer-only tool (`approve_specs`, `request_from_attendees`, `list_guests`, `search_gifts`, and the rest of the organizer list) never registers for a store caller. The polyfill loads on the store page with `?webmcp=polyfill` as it does on the dashboard.

## The bridge

The merchant tools and Shopify's page tools exist only on the store's pages. Tokuchu's server opens a page of the store in a headless browser (`src/server/store-page.ts`), injects the WebMCP polyfill before the page scripts run so that both Shopify's script and the theme asset register their tools, waits for `getTools()` to list them, and calls them with `executeTool`.js` beside the polyfill. The cart the tools build belongs to that browser session. The `checkoutUrl` the cart tool returns, `/cart/c/{token}?key=...`, opens the same cart at Shopify's checkout in any browser, which is how the cart leaves the session and reaches the organizer.

The optional curation run (`POST /api/events/{id}/curate`) wraps hops 1 and 2 in an agent whose tool steps stream to the dashboard.
