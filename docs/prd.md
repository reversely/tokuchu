# Tokuchu: agentic event procurement over WebMCP

## 1. Summary

Tokuchu is an event procurement system that uses attendee information and WebMCP-enabled storefronts to coordinate personalized purchases for events. WebMCP lets a web page publish tools: functions with a name, a description, and a JSON Schema for their input, registered on the page's model context, which an agent discovers and calls. Shopify's storefronts publish such tools on every page and answer the same calls over HTTP at each store's UCP endpoint. Tokuchu acts as the agentic orchestration layer over those tools: it consumes the merchant's capabilities, coordinates the attendee information those capabilities require, and uses the resulting structured data to prepare the personalized purchase.

The app begins with an RSVP list containing attendees and the information associated with them. The organizer uses the app to source personalized products for those attendees. The app searches Shopify stores through Shopify's existing WebMCP commerce capabilities and returns products that match the organizer's request. The organizer reviews the recommended products and selects the vendor and product to use. The app then calls the merchant's own WebMCP tool, `get_customization`, which returns the merchant-specific customization requirements for the selected product in structured form, so the app holds no predefined field list for any product. The app compares those requirements with the information already associated with each attendee, determines which required values are missing for each attendee, and sends each attendee a request for those values by email. Responses return to the app and attach to the attendee record; the app tracks who has completed the request and follows up where information remains missing. Once every unit's values are complete, the app uses Shopify's existing WebMCP cart functionality, through the merchant's `add_customized_to_cart` tool, to add one configured item per attendee to the merchant's cart. The resulting cart returns to the organizer, who inspects it and completes checkout.

The product is designed around event-scale personalization. The organizer makes one procurement decision for an event, and the app handles the individualized information required to configure the corresponding item for each attendee. The core behavior in one line:

```
Find a customizable product
→ learn what that merchant needs
→ collect those values from the right attendees
→ use the completed data to prepare the customized order
→ return the order to the organizer for review
```

Tokuchu is built against one specific demo site: a live Shopify store, deployed as a separate component of the project, whose theme carries the merchant tools and whose celestial-map shirt the search surfaces (Section 6). Tokuchu is itself a WebMCP publisher. The organizer's page registers the event's records as tools on its model context, and the same list serves over HTTP to a token holder, so a browser agent or a vendor's agent reads attendees, answers, and the manifest through tool calls. Tokuchu deploys on Render with a Postgres database and a magic-link sign-in.

## 2. Conventions

- **WebMCP** names the browser API by which a page registers tools on `document.modelContext` (or `navigator.modelContext`) with `registerTool`, and an agent lists them with `getTools` and runs one with `executeTool`. A browser with native support provides the model context; otherwise a polyfill script loaded before the page's own scripts provides it.
- A **tool** names one registered function: a name, a description, an input schema in JSON Schema, an optional output schema, and an execute function. A **tool call** names one invocation with arguments that fit the input schema, returning content and structured content.
- An **agent** names the caller of tools. In this document the agent is Tokuchu's server driving a headless browser page, Tokuchu's curation agent running a language model with tool wrappers, or a browser agent acting on the organizer's page.
- A **store** names a Shopify storefront that publishes WebMCP tools. Its **page tools** register on every page's model context. Its **UCP endpoint** at `{shop}/api/ucp/mcp` answers the same tool calls as JSON-RPC from a server.
- A **merchant tool** names a page tool the merchant adds to the theme beyond Shopify's own: `get_customization` and `add_customized_to_cart`.
- A **customization requirement** names one value the merchant needs to make a unit, as `get_customization` states it: key, label, kind (text, name, location, date, time, image), required flag, and constraints (a maximum length, an allowed set).
- A **record** names a row in Tokuchu's database. A **question** names an `AttributeDefinition` record: one value Tokuchu asks an attendee for, with a value type and constraints. An **answer** names an `AttributeValue` record for one attendee and one question.
- A **source** for a requirement names where its value comes from: an answer the attendee gave, a field of the event (the venue, the date), or a literal the organizer typed.
- A **request** names the set of questions Tokuchu sent to one attendee, with the time it was sent and the answered state of each question.
- A **unit** names one configured item for one attendee: a variant plus a value per requirement.
- Money appears in minor units as Shopify returns it. Dates use ISO form.

## 3. The three WebMCP uses

The app uses WebMCP in three connected parts of the same workflow.

1. **Product discovery.** The app uses Shopify's existing WebMCP functionality to retrieve products from Shopify storefronts that may satisfy the organizer's procurement request. It calls `search_catalog`, `lookup_catalog`, and `get_product` at the Global Catalog and at each store's UCP endpoint, so it works with storefronts through the commerce capabilities Shopify already exposes (Section 11).
2. **Product-specific customization discovery.** The selected merchant exposes its own WebMCP tool, `get_customization`, which returns the specific customization inputs the chosen product requires. For the celestial-map shirt this includes the required name, location, and time values and their constraints, such as the name remaining under 20 characters. This merchant tool extends the standard Shopify commerce capabilities with information specific to the merchant's product and fulfillment process, and it lets the merchant communicate its own fulfillment requirements to the app in structured form (Section 9).
3. **Customized cart creation.** After the app has collected the required customization data from attendees, it uses Shopify's existing cart functionality, through the merchant's `add_customized_to_cart` tool, to create the configured cart items. The app therefore uses information retrieved from the merchant's tool together with attendee responses to execute the order through Shopify (Section 10). The merchant tool wraps Shopify's cart endpoint because Shopify's own cart tools carry a variant and a quantity per line and no text (Section 5).

The full app flow:

```
RSVP list
    ↓
Organizer requests personalized products
    ↓
App searches Shopify storefronts through WebMCP
    ↓
Relevant products are returned
    ↓
Organizer selects a vendor and product
    ↓
App calls the merchant's get_customization WebMCP tool
    ↓
Merchant returns the exact customization fields it requires
    ↓
App compares those requirements with existing attendee data
    ↓
Missing attendee-specific values are identified
    ↓
App sends attendees forms requesting the missing information
    ↓
Attendee responses return to the app
    ↓
App tracks completion and follows up where necessary
    ↓
All required customization values are assembled
    ↓
App uses Shopify WebMCP to populate customized cart items
    ↓
Completed cart is returned to the organizer
    ↓
Organizer reviews and checks out
```

## 4. The organizer and the loop

The organizer runs a recurring event, such as an annual symposium, and orders one personalized item per attendee. In one week the organizer publishes the event, chooses the item, and collects answers as replies arrive. A wrong name or size on a unit costs them a reprint and a late delivery, so every answer records who gave it and when.

The loop the organizer runs:

1. **Sign in and create the event.** The organizer sets the title, the date, the venue, the spots, the RSVP deadline, and the delivery target, then publishes. Publishing creates the link attendees reply through.
2. **Request personalized products.** The organizer types a sentence such as "personalized star map crewnecks with each attendee's name". The app calls the catalog tools and shows ranked products with the store each came from.
3. **Select the vendor and product.** The organizer picks one. The app calls that store's `get_customization` and records the requirements the product carries.
4. **Review what will be asked.** The app shows each requirement with its source: a value the RSVP already holds, a value the organizer maps to an event field, or a question for the attendee. The organizer confirms.
5. **Attendees answer.** Each attendee with a missing value receives an email carrying their own link to a form with the fields the selected product requires. The organizer watches the records grid fill, one row per attendee and one column per requirement, and the app follows up with whoever has not answered.
6. **Approve.** When every unit is complete, the organizer approves. The app calls `add_customized_to_cart` with one item per attendee and shows the checkout link the tool returned.
7. **Review and check out.** The organizer opens the link, inspects the populated cart with one line per attendee, and completes the store's checkout. The app reads the order and its fulfillment state afterward through Shopify's Admin API and shows them on the dashboard.

## 5. What the store provides

**Shopify's UCP endpoint.** Every surveyed store answers `tools/list` at `{shop}/api/ucp/mcp` with thirteen tools: `search_catalog`, `lookup_catalog`, `get_product`, `create_cart`, `get_cart`, `update_cart`, `cancel_cart`, `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout`, `get_order`. Each call carries a link to a public agent profile document. The Global Catalog at `catalog.shopify.com/api/ucp/mcp` answers the same search across stores. Tokuchu's discovery (Section 11) calls these from the server.

**Shopify's page tools.** The store's pages load Shopify's storefront WebMCP script, which registers ten tools on `document.modelContext`: `browse_store`, `search_catalog`, `get_product`, `show_variant`, `get_cart`, `update_cart`, `cancel_cart`, `proceed_to_checkout`, `manage_orders`, and `search_shop_policies_and_faqs`. The script registers them only when a model context exists before it runs, so a headless driver injects the polyfill first.

**What a Shopify cart line carries.** A UCP line item holds an id, an item, a quantity, and totals. The page tool `update_cart` takes a variant id and a quantity. Neither carries a text value, so a printed name reaches the store through the merchant tool below, which adds the line with Shopify's cart endpoint and the values as line item properties.

**The merchant tools.** The theme registers two more tools on every page:

| Tool | Input schema | Returns |
| --- | --- | --- |
| `get_customization` | `{ product_id }` | the requirements with their kinds and constraints, read from a product metafield the theme exposes, and the live variants |
| `add_customized_to_cart` | `{ items[]: { recipient_ref, variant_id, values }, idempotency_key }` | one cart line per item added through `/cart/add.js` with the values as properties, the line keys, and the cart's `checkoutUrl` |

`add_customized_to_cart` validates every item against the requirements before adding any: an unknown key, a missing required value, or a value over its maximum length returns the item's issues and adds nothing. A repeated call with the same idempotency key adds nothing and returns the recorded lines.

**The shareable cart.** The storefront's session cart resolves as a Storefront API cart, `gid://shopify/Cart/{token}`, whose `checkoutUrl` takes the form `{shop}/cart/c/{token}?key=...`. That URL opens the cart at Shopify's checkout in any browser, with every line and its properties. Measured on the demo store on 2026-09-03: a cart built in one session opened in a fresh browser with both personalized lines shown. Cart permalinks carry properties on the first line only, so they cannot express a multi-attendee cart.

**Shopify's Admin API.** Tokuchu reads orders and fulfillment state through the GraphQL Admin API with a client-credentials grant. The store and the app share one Shopify organization. Card data stays with Shopify's checkout.

## 6. The demo store and the interaction between the two components

The project has two deployed components. Tokuchu is the organizer's app. The demo store is a live Shopify store, `springbuilt.myshopify.com`, trading as Customworks, which sells a customizable celestial-map shirt through the Customily app. The store was selected and configured so that this product surfaces clearly when the app searches for customizable products through Shopify's WebMCP tools: a search for a personalized star map crewneck ranks it within the first page of results from the Global Catalog and the store's own UCP endpoint. The app's flow is developed, tested, and recorded against this store. Any other WebMCP-enabled store answers discovery and Shopify's own tools; personalization on another store needs that store to publish the two merchant tools.

WebMCP development happens in both components. In Tokuchu it is the tool registry on the organizer's page and the MCP endpoint. In the store it is the theme asset that registers `get_customization` and `add_customized_to_cart` on every page, and the product metafield that holds the shirt's requirements: a name limited to 20 characters, a location, and a time for the star map, with six size variants. Building those tools in the store is part of the project's scope, and a change to the shirt's requirements is a change to the metafield rather than to Tokuchu.

The interaction between the two runs over WebMCP in both directions:

- **Tokuchu to the store, from the server.** Discovery calls the store's UCP endpoint as JSON-RPC with a link to Tokuchu's public agent profile, which the endpoint requires on every call.
- **Tokuchu to the store, in a page.** The merchant tools and Shopify's page tools exist only on the store's pages, so Tokuchu's server opens a page of the store in a headless browser, injects the WebMCP polyfill before the page scripts run, waits for the tools to register on the model context, and calls them with `executeTool`. Until the theme carries the merchant tools, the server injects the asset beside the polyfill. The cart the tools build belongs to that browser session; the `checkoutUrl` the cart tool returns carries the cart out of the session to the organizer.
- **A browser agent to Tokuchu.** A judge or organizer using a browser with WebMCP enabled opens Tokuchu's dashboard and finds the event's records registered as tools, with schemas and execute functions, and acts on them with the organizer's identity.
- **A vendor's agent to Tokuchu.** The same tool list serves over HTTP at the MCP endpoint to a token holder, so the store side can read the manifest or post an update without a browser.

## 7. Screens

**Sign-in.** The organizer enters an email address and receives a magic link. Following it opens their events. An attendee's invite link opens without a session.

**Draft.** One page holds Details (title, date and time, host, location, spots, cost per person, RSVP deadline, description), Delivery (one address for every unit and a needed-by date), and Settings. The right column renders the invite from the same data. One button publishes and creates the link.

**Dashboard.** The published event shows three tabs.

- **Overview** shows response counts, the attendee table, and the editable setup sections.
- **Guest Experience** holds the sentence box, the ranked results with the store each came from, the pick, and the fields the store returned with their sources. The organizer confirms the sources here. When a curation run is used, its tool steps stream into this tab as they happen.
- **Attendees** shows the questions requested from attendees, the records grid with one row per attendee and one column per field with each cell marked answered or missing, the request and follow-up actions, the approve action, and after approval the checkout link and the order state.

**Invite form.** An attendee's link opens the event's invite with the name field, the response choices, and one control per question the attendee has been asked: a text field with the store's length limit, a choice with the store's variant values. The attendee edits from the same link until approval locks the answers. The invite page registers the same form as a WebMCP tool, `submit_rsvp`, whose input schema lists one property per requested question with the store's constraints, so an attendee's browser agent answers through a tool call.

## 8. Records and Tokuchu's tools

The app's main internal responsibility is coordinating the stages above. It maintains: event information, the RSVP list, attendee information, the selected vendor, the selected product, the merchant's customization requirements, the required attendee responses, the submitted customization values, response completion state, cart preparation state, and the final cart link. These map onto the records below.

- **Event**: title, date, venue, spots, RSVP deadline, delivery target, settings, owner, invite code.
- **Party** and **Guest**: the invitation unit and each attendee with a response status and a display name.
- **AttributeDefinition**: a question with a key, a label, a value type (text, number, boolean, enum, multi_enum, date, file, reference), constraints, and the customization field it was derived from when a store's schema created it.
- **AttributeValue**: one attendee's answer to one question, with who gave it, when, and a lock once approval fixes it.
- **Gift**: the chosen store and product, its variants, the requirements the store returned, the source per field, the per-attendee variant mapping, the approval time, the locked answers, the cart line keys, the checkout URL, and the order id and fulfillment state once the organizer has paid.
- **Request**: per attendee, the questions sent, the send time, and the answered state of each.
- **CallerToken**: a scoped credential for an agent calling over HTTP, naming the readable questions and the callable tools.
- **Change log**: every write to answers, statuses, and gifts in one rising sequence, so a poll reads what changed since a sequence number.

Tokuchu publishes its records as tools. The organizer's page registers them on `document.modelContext`, and the MCP endpoint at `/api/events/{id}/mcp` serves the same list to a token holder over JSON-RPC. Each tool maps onto one API route.

| Tool | Returns or does |
| --- | --- |
| `get_guest`, `list_guests` | one attendee or the attendees matching a filter, with typed answers |
| `count_by`, `get_summary`, `list_missing` | per-option counts, several counts in one call, attendees with no answer |
| `search_gifts` | the ranked candidates from every source with the funnel |
| `configure_product` | the gift for a product and the fields its `get_customization` returned |
| `set_field_sources` | the source per requirement, or the validation errors |
| `request_from_attendees` | the request per attendee for their missing fields |
| `get_manifest` | one row per attendee: variant, resolved values, and each row's ready or incomplete state |
| `approve_specs` | locks the answers, fills the store's cart, records the checkout URL |
| `get_changes` | the change log after a sequence number |
| `submit_rsvp` (invite page) | records an attendee's response and answers, with the store's constraints in its schema |

## 9. Deriving the questions and tracking completion

**Comparison.** When the organizer selects a product, the app stores the requirements `get_customization` returned and compares them with the information already associated with each attendee. A requirement whose value the RSVP already holds, such as a name, needs no question. A requirement the organizer maps to an event field, such as the venue for a location, needs no question. Every other requirement becomes a question for the attendee, carrying the store's constraint, so a 20-character limit on the name becomes a 20-character limit on the question, and a variant axis such as size becomes a choice whose options are the store's variant values. The app determines per attendee which required values are missing.

For example, the RSVP may already know an attendee's name but not the location and time they want used for their celestial map. The collection sequence:

```
Organizer selects product
        ↓
Merchant returns customization requirements
        ↓
App compares requirements with attendee data
        ↓
Missing values are identified
        ↓
Attendees receive requests for those values
        ↓
Responses return to the app
        ↓
Customization data becomes complete
```

**Requests.** The app generates a request for the missing values and sends it to the relevant attendees by email through Resend, each carrying the attendee's own link. The attendee receives a form containing the fields required for the selected product. Their submitted values return to the app and attach to their attendee record. The app records per attendee which questions were sent and when, and it sends a follow-up to every attendee whose request still has an unanswered question. In development the link is logged in place of the email.

Once the required data has been collected, the app holds a complete set of values for each unit. For example:

```
Attendee 1
name: Maya
location: Toronto
time: 9:00 PM
Attendee 2
name: Jordan
location: Vancouver
time: 10:30 PM
```

**Completion.** The records grid marks each cell answered or missing. The manifest resolves every field per attendee from its source and grades each row ready or incomplete, naming the missing field. Approval is available when every row is ready.

**Approval.** Approval locks the answers the gift reads, so a later edit from the invite link returns the lock and the organizer's contact. Tokuchu then fills the cart (Section 10).

## 10. Filling the cart and the handoff

For each attendee the app maps the relevant values into the selected product's customization fields and adds the configured item to the merchant's cart through the merchant's tool. On approval Tokuchu runs a job inside the app. The job opens the store's product page in a headless browser with the WebMCP polyfill, waits for the merchant tools to register, builds one item per ready manifest row, and calls `add_customized_to_cart` once with every item and an idempotency key derived from the gift and its approval time. The tool returns the line keys and the cart's `checkoutUrl`. Tokuchu stores both on the gift and shows the link on the Attendees tab.

The organizer opens the link, reviews one line per attendee with the values as line properties, enters the delivery address, and pays at Shopify's checkout. Tokuchu polls the Admin API for the order and its fulfillment state and shows them beside the link.

The job posts its progress into the change log, so the dashboard's poll shows the step it is on and any item the store refused, with the field and the reason. The Attendees tab shows the cart link once it arrives and the failure text when the store did not fill the cart.

## 11. Product discovery and ranking

Discovery searches the Global Catalog and each configured store's UCP endpoint for the organizer's sentence and ranks the results.

**Eligibility.** A product passes when the store ships to the delivery target, the delivery window plus a buffer of three days falls on or before the needed-by date, the unit price falls at or under the budget, and at least one variant is available. The delivery window comes from a `create_checkout` probe that is never completed. The first failing rule is the reason the results screen gives.

**Scoring.** Each eligible product receives a weighted score: coverage (30), lead-time margin capped at 14 days (25), price fit rewarding a price between 60% and 100% of the budget (20), delivery confidence (15), cancellation terms (10), seller signal (5). For a personalized request, coverage is 1 only when the store answers `get_customization` for the product with at least one field. The weights live in a configuration row.

**The demo store in the ranking.** A search for a personalized star map crewneck ranks the demo store's crewneck within the first page of results from the Global Catalog and the store's own endpoint.

## 12. Deployment and accounts

- **Host.** A Render Web Service built from a Dockerfile that bundles Node and Chromium, because the approval job drives the store page with Playwright.
- **Database.** Render Postgres. Each event is one row holding its records as a JSON document, plus the sign-in tables. A request loads its event's document, runs the domain code, and writes the document back.
- **Sign-in.** Auth.js with a magic-link provider and Resend as the sender. An allowlist of organizer emails in the environment decides who may sign in. Each event records the user id of the organizer who created it. Organizer routes require a session and check the event's owner: a request with no session answers 401 or goes to the sign-in page, and a session that owns another event answers 403 or the not-found page. Invite links, the RSVP routes, and the read of a guest's own record by the id on the invite link stay public and never return the owner. Without `DATABASE_URL` outside production a request with no session runs as one local organizer, so the dev server and the browser suites need no sign-in; an event a signed-in account owns still answers such a request as it answers a stranger.
- **Environment.** `DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`, `ORGANIZER_EMAILS`, `OPENAI_API_KEY`, `CUSTOMILY_SHOP_URL`, and the four Shopify Admin keys. Secrets live in Render's environment and in a local `.env` that stays out of the repository.

## 13. Tests and the recorded demo

Vitest covers the domain, the operations, the tool list, the comparison, and the request tracking. Playwright covers the draft, the invite, the dashboard tabs, and the tools through the polyfill. The live suites, gated by `LIVE_CUSTOMILY=1`, run against the demo store.

The recorded demo runs in this order: sign in and create the event; describe the item and watch the search rank the store's crewneck; pick it and watch `get_customization` return the fields; request the size and the name from attendees; load the attendee responses; watch the grid complete; approve; open the checkout link in a fresh browser and see one line per attendee. The responses in the recording are loaded through the RSVP API in place of email replies.

## 14. Decisions taken

1. **The store states its own fields.** `get_customization` is the source of every question a product adds.
2. **Values travel as line item properties.** `add_customized_to_cart` adds each unit through Shopify's cart endpoint with the values as properties, because neither the UCP cart nor the page cart tool carries text.
3. **The organizer pays at the store.** Tokuchu hands over the cart's checkout URL and the organizer completes Shopify's checkout. Shopify's checkout holds the card.
4. **The Admin API reads orders.** Order and fulfillment state come from the GraphQL Admin API after the organizer pays.
5. **One event per document.** Persistence stores each event's records as one JSON document in Postgres, so the domain code stays the same in memory and on disk.
6. **Magic-link sign-in with an allowlist.** Organizers sign in by email, and an attendee's link opens without a session.

## 15. The hackathon submission

Tokuchu is a submission to The WebMCP Challenge (webmcp.devpost.com), due 2026-09-03 at 1:00 pm PDT. The submission requirements and how the project meets each:

- **A working live URL** that judges open in ChatGPT's in-app browser or in Google Chrome with WebMCP enabled. The Render deployment (Section 12) serves the dashboard, where the event's records register as tools on the page's model context, and the demo store serves the merchant tools.
- **Actual tool registration** with functional schemas and execute functions. Tokuchu's tools are defined as data with JSON Schema inputs (`src/webmcp/tools.ts`) and registered with `registerTool`; the store's two merchant tools register the same way in the theme.
- **A text description** of why WebMCP fits the use case, how it improves the experience, what people and agents accomplish together, and the implementation. Sections 1, 3, and 6 of this document carry that content.
- **A public video under three minutes** with audio, showing the build and the WebMCP use. Section 13 gives the recording order.
- **A public repository** with the source, the assets, the instructions, and an open-source license file.

The judging criteria are WebMCP leverage, execution, potential impact, and creativity and ambition. The project answers the first with tools on both ends and an agent bridging them, and the second with a flow that runs end to end on the live store.
