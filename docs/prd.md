# Tokuchu: Turn your RSVP list into seamless agentic procurement for events

## 1. Summary

Tokuchu collects attendance for an event and the personalization data each attendee's merchandise needs, then turns that data into orders at WebMCP-enabled Shopify stores. The organizer chooses which products the event will order. Tokuchu reads each product's personalization schema through WebMCP and builds the attendee survey from that schema, so the store defines the questions and the organizer stops authoring them by hand. An attendee signs up through an RSVP link or a ticket link. When the organizer approves the attendee, either automatically or by hand as a setting decides, Tokuchu requests the fields that attendee's items need in one survey, and it merges a field that two products share so a question such as a printed name is asked once. At a cutoff, which the organizer sets to fire when signups close, a fixed period after that, or on a manual trigger, Tokuchu confirms and audits the order list, skips any attendee who did not answer as the non-responder setting decides, and orders the goods from the stores.

The organizer authorizes the spend once, and Tokuchu can then place the orders within that authorization without further clicks. The secure form of that authorization is a delegated payment token described in Section 9. The demo models attendance, approval, the survey, the cutoff, and a placed test order on a real store, and it shows payment authorization and paid ticketing as future features, so no real money moves.

Tokuchu's page registers its records as WebMCP tools, so a browser agent reads and acts on them with the organizer's identity. The same tools serve over HTTP from Tokuchu's server, so a vendor's own agent reads the manifest and the change feed for its batch and posts confirmations, progress, and questions back. A vendor that sells through Shopify reports through its order; a vendor that runs an agent of its own reports through Tokuchu.

This design keeps the RSVP form as the attendee's survey surface, keeps the `AttributeDefinition` and `AttributeValue` records that store the questions and answers, keeps the WebMCP tool list and the two paths that reach it, and keeps the vendor selection and reporting of Sections 8 and 10. It changes where the survey questions come from: the configured products' personalization schemas, read live through WebMCP, replace a hand-authored question library as the source of what to ask. An organizer-written question becomes an addition to that derived set rather than its origin.

## 2. Conventions

- A **record** names a row in Tokuchu's store. Every domain item (a question, a role, a gift plan, an approval, a payment authorization) occupies a row; the code knows eight value types, one filter grammar, and the tool list in Section 6.
- A **tool** names one definition (name, description, input schema, the API route it maps to) rendered two ways: the page registers it on `document.modelContext`, where a browser agent calls it, and Tokuchu's MCP endpoint at `/api/events/{id}/mcp` serves it, where an agent with a token posts `tools/call`. Both render the same list, and one route sits behind each.
- A **caller token** names a row that records who holds it (a vendor domain or a person), which event, which definitions it may read, which tools it may call, and when it expires. The organizer's page needs none; every HTTP caller presents one.
- A **Shopify call** names an HTTP POST from Tokuchu's server to a Shopify MCP endpoint: the Global Catalog at `catalog.shopify.com/api/ucp/mcp` or a shop's own endpoint at `{shop}/api/ucp/mcp`. The body names a tool and its arguments. Shopify makes no call to Tokuchu.
- A **source** names where discovery finds a product: the Shopify Global Catalog, the print shop, or a configured custom shop. Discovery searches every configured source; Section 10 ranks the results.
- A **personalization field** names one value a vendor prints on a unit, as the vendor's schema states it: key, label, kind (text, name, monogram, date, location, star_map, color, word_list), required flag, and limits. Tokuchu reads this schema through WebMCP and never hardcodes it.
- The **survey** names the set of fields Tokuchu asks an approved attendee to fill. Tokuchu derives the survey from the personalization schemas of the products the organizer configured, merging fields that share a key so each question appears once.
- A **mapping** sends one value into one vendor field: an attendee's survey answer, an event field (title, starts_at, venue), or a literal, with an optional transform (uppercase, lowercase, date_only, location_query). When the survey field key matches the vendor field key, the mapping is implicit.
- **Attendance** names how a person joins: an RSVP reply, or a ticket. A ticket may be free or paid; a free-ticket holder still receives merchandise, so ticketing gates attendance and does not fund the order.
- **Approval** names the organizer's decision that an attendee counts toward the order. A setting makes approval automatic on signup or manual per attendee. Approval is the event that triggers that attendee's survey request.
- The **delivery target** names where the goods ship and by when. A per-event setting sends every unit to one address (the venue or another address the organizer sets) or collects each attendee's own address in the survey and ships to each person.
- A **payment authorization** names the organizer's standing consent to spend up to an amount at named stores before an expiry. Section 9 describes its secure form. Tokuchu stores the authorization's reference and bounds, never a card number.
- Money appears in minor units (cents) as Shopify returns it. Dates use ISO form.
- Section 13 records the decisions taken.

## 3. Measurements of Shopify's agent surface

The room planner's storefront survey and the favor survey in `spikes/favor-vendors/` established what a shop answers.

- Every surveyed shop answers `tools/list` at `{shop}/api/ucp/mcp` with the same thirteen tools: `search_catalog`, `lookup_catalog`, `get_product`, `create_cart`, `get_cart`, `update_cart`, `cancel_cart`, `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout`, `get_order`. Each shop requires one credential: a link to a public agent profile document.
- `search_catalog` takes free text and filters: `ships_to` (an address), `ships_from` (a list of countries the shop is located in), `available`, `price` (min, max), `categories`, `attributes` (Color, Size, Target gender), `price_tier` (low, medium, high within a product's category), `shops`. It returns up to 50 products a page with `total_count`; each product names its seller and its option names.
- `get_product` returns the full description, every variant with its option values, prices, and availability, and accepts free-text buyer preferences.
- `create_cart` and `update_cart` take `line_items[] = { item: { id: variant }, quantity }`, a buyer (email, phone), a fulfillment destination, and discount codes. No line carries a note, an attribute, or text.
- `create_checkout` returns fulfillment options whose titles carry the delivery window; the room planner reads the same field for delivery evidence. `complete_checkout` takes a payment instrument.
- The checkout's card fields render inside per-field iframes served from `checkout.pci.shopifyinc.com`, so the card data stays with Shopify's payment host and never reaches Tokuchu. Section 9 uses this boundary.
- The Global Catalog answers 429 after a burst of searches; Tokuchu spaces its calls and retries for up to a minute.

Three consequences follow for a Shopify-fronted order: personalization reduces to variant choice and quantity in the cart; a printed name reaches the vendor outside the cart, through the manifest, the print shop's units, or the custom shop's storefront adapter (Sections 7 and 8); and the cart's contents over time carry everything the shop receives through the cart.

## 4. The user and the loop

The user is an events organizer who runs a recurring event, such as a company symposium or a birthday, and needs each attendee's personalization data collected and turned into vendor orders. In a week she configures the merchandise the event will send, approves the people who sign up, reviews the order list before it goes out, and authorizes the spend. A wrong name on a unit or a missing size costs her a reprint and a late delivery, so the record names who submitted each value and when it locked.

The loop she runs:

1. **Create the event.** She sets the title, date, venue, spots, the RSVP deadline, and the delivery target, then publishes and receives an RSVP or ticket link.
2. **Configure the merchandise.** She searches the configured stores through WebMCP (Section 10), picks one or more products, and confirms the mapping from event fields and survey answers into each product's personalization fields. Tokuchu reads each product's schema and builds the survey from it.
3. **People sign up.** Attendees reply through the link. A paid ticket collects money in a future release; a free ticket or an RSVP records attendance now.
4. **Approve.** Tokuchu approves each attendee automatically or holds them for her, as the approval setting decides. Approval issues that attendee's survey request for the fields their items need.
5. **Collect the survey.** The attendee fills the merged survey once. Adding a product later can send a follow-up request for only its new fields.
6. **Cut off, confirm, audit.** At the cutoff she set, Tokuchu freezes the order list, resolves each unit's values, and reports which units are ready, incomplete, or excluded. A non-responder's unit is skipped or held as the setting decides, never guessed.
7. **Authorize and order.** She authorizes the spend once (Section 9). Tokuchu orders the goods from the stores within that authorization, or she places each order herself.
8. **Report and deliver.** Each vendor reports progress into the same records, and the goods ship to the target the delivery setting names.

## 5. Organizer and attendee screens

**Draft.** One page holds four sections: Details (title, date and time, host, location, spots, cost per person, RSVP deadline, description); Delivery (one address for every unit, or per-attendee addresses collected in the survey, plus a needed-by date); Merchandise (the products the event will order, each added from the store search of Section 10, with its mapping shown); and Settings (approval automatic or manual, the cutoff trigger, reminders, the non-responder rule, per-attendee shipping). The right column renders the invite from the same data. One button publishes and creates the link.

**Published.** The same page becomes the dashboard with two tabs.

- **Overview.** The tab shows response counts (going, maybe, can't go, no reply) and approval counts (approved, pending); follow-ups (approved attendees with a survey still open, attendees missing a required field, unresolved maybes, unservable attendees); the attendee table; the order summary with each product's unit count and price; and the editable setup sections, which state the delivery target and the cutoff.
- **Merchandise.** The tab shows each configured product with the survey fields it needs, the unit count per variant, the price, the delivery window, and the cutoff, with Edit, Remove, Send to vendor, Add another product, and an ask bar for questions such as which order confirms first or who is missing a value. The organizer configures a product here through the store search and the mapping review; Section 10 ranks the search.

**Payment.** The dashboard shows a Payment panel where the organizer will authorize the spend. In this release the panel is present and greyed, labeled a future feature, and it moves no money. Section 9 describes the authorization the panel will take.

**Survey.** An approved attendee opens a survey link scoped to them. The form shows the merged fields the configured products need: a text field for a printed name, a select whose options are the store's real variant values for a size, a location and a date for a star map. Every option comes from the store's schema through WebMCP. The attendee edits or resubmits from the same link until the cutoff. A value the cutoff locked rejects a later edit and shows the organizer's chosen path (Section 7, Cancellations).

## 6. Data model and Tokuchu's tools

The model holds eight entities and two derived records.

**Event**: id, type, segments (each with id, name, capacity), venue address, event date, RSVP deadline, cost per person, spots, field definition list, delivery (one address or per-attendee, the address when set, needed-by date), settings (approval mode, cutoff trigger, non-responder rule, per-attendee shipping).

**Party** names the invitation unit: id, guest ids, contact, plus-one allowance.

**Guest**: id, party id, role (a row the organizer creates: guest, plus-one, child, speaker), status, approval (pending, approved, declined), attendance kind (rsvp or ticket), attendance as a map of segment id to boolean, display name.

**AttributeDefinition**: id, namespace (`core`, `organizer`, or `derived`), key, label, scope (guest, party, event), value type, constraints (options, min, max, max length, pattern), default visibility, required rule, creator, and the vendor field it came from when the definition was derived from a product schema. The eight value types cover text, number, boolean, enum, multi_enum, date, file, reference. A derived definition reads its options and limits from the store's schema, so a size question carries the store's real variant values. Validation, form rendering, and aggregation switch on the value type and read everything else from the row.

**AttributeValue**: subject type, subject id, definition id, typed value, source (guest, organizer, or agent), lock (batch id and date, or null), updated timestamp, sequence number.

**Batch** (derived): gift id, product id, shop domain, recipients filter, variant mapping (definition value to variant id), default variant, fallback for a missing value, post-lock cancellation choice, cutoff, `cart_id`, `checkout_id`, `order_id`, `locked_definition_ids`, per-guest unit status: open, locked, unservable, held, excluded, cancelled_reassignable, cancelled_sunk. A personalized product's batch also stores the vendor's field schema and the mappings `set_personalization_mapping` stored; its manifest rows add the resolved value per field, a status (ready, incomplete, invalid), and the issues, each with a code (missing_source, missing_value, invalid_type, too_long, unsupported_value).

**PaymentAuthorization** (future): id, event id, provider reference (a vaulted payment method), the amount cap, the store whitelist, the expiry, the status. Tokuchu stores the reference and the bounds; the card data stays with the provider (Section 9).

**VendorUpdate**: gift id, caller token, kind (confirmed, in_production, shipped, delivered, issue, question, proof), text, expected date, reference (a tracking number or an order number), asset (for a proof), created timestamp, sequence number. Tokuchu records an organizer's reply as a VendorUpdate of kind `reply` with the organizer as caller.

**CallerToken**: id, event id, holder (a vendor domain or a person), gift ids it covers, readable definition ids, callable tools, expiry, the agent profile URL it presented last.

**Change log** (derived): the ordered sequence of writes to AttributeValues, to Guest.status and Guest.approval, and of VendorUpdates, read by sequence number. A vendor needs to see a cancellation, and the organizer needs to see a vendor's confirmation, so the log records both.

Filters use one grammar everywhere: a list of `{field, op, value}` where field holds a structural path (`status`, `approval`, `role`, `attendance.<segment id>`, `party.size`) or a definition id.

The table below lists Tokuchu's tools. Each maps one definition onto the route beside it; the page renders it and the MCP endpoint serves it. The Scope column says which callers may use it.

| Tool | Route | Scope | Returns or does |
| --- | --- | --- | --- |
| `get_guest(id, fields[])` | `GET /api/events/:id/guests/:guestId` | organizer | one guest with typed values |
| `list_guests(filter, fields[])` | `GET /api/events/:id/guests?filter=` | organizer | matching guests |
| `set_approval(guest_id, decision)` | `POST /api/events/:id/guests/:guestId/approval` | organizer | the approval, and the survey request it issued |
| `count_by(definition_id, filter)` | `GET /api/events/:id/counts?definition=&filter=` | organizer, vendor (readable definitions only) | per-option counts for enum and multi_enum; sum and quartile buckets for number; true and false counts for boolean |
| `list_missing(definition_id, filter)` | `GET /api/events/:id/missing?definition=&filter=` | organizer | approved guests with no value |
| `get_summary(filter, definition_ids[])` | `GET /api/events/:id/summary?...` | organizer, vendor (readable definitions only) | `count_by` for several definitions in one call |
| `get_manifest(gift_id)` | `GET /api/events/:id/gifts/:giftId/manifest` | organizer, vendor (its gift ids, its readable definitions) | one row per guest: variant, unit status, and the values the token may read; a personalized gift's rows add the resolved field values with their status and issues |
| `get_changes(since_seq)` | `GET /api/events/:id/changes?since=` | organizer, vendor (entries visible to it) | the change log after a sequence number |
| `search_gifts(card?, sentence?)` | `POST /api/events/:id/search` | organizer | the ranked candidates from every source, the excluded ones with the rule that excluded each, and the funnel per search |
| `configure_product(product_id)` | `POST /api/events/:id/gifts` | organizer | the gift plan for the product, and the survey fields its schema derived |
| `set_gift_plan(gift_id, rules[])` | `PATCH /api/events/:id/gifts/:giftId` | organizer | the derived quantities per variant |
| `set_personalization_mapping(gift_id, mappings[])` | `POST /api/events/:id/gifts/:giftId/personalization` | organizer | the stored mappings, or the validation errors to fix |
| `send_to_vendor(gift_id)` and `approve(gift_id)` | `POST .../send`, `POST .../approve` | organizer | the priced proposal; the approval |
| `post_update(gift_id, kind, text, expected_date?, reference?, asset?)` | `POST /api/events/:id/gifts/:giftId/updates` | vendor (its gift ids), organizer (kind `reply`) | the update as recorded, with its sequence number |
| `get_updates(gift_id, since_seq?)` | `GET /api/events/:id/gifts/:giftId/updates` | organizer, vendor | the thread for one gift |

In the page the organizer acts as caller and needs no token. Over HTTP every call carries a token, and Tokuchu checks the token's readable definitions, gift ids, and callable tools on every call, so a definition's visibility list binds vendors. A vendor token holds no tool that spends money.

## 7. Deriving the survey and resolving the order

**Deriving the survey.** When the organizer configures a product, `configure_product` reads the product's personalization schema through WebMCP: the print shop's `get_design`, the custom shop's storefront `get_personalization_schema`, or a Shopify product's variant option names from `get_product`. Each field the schema names becomes an `AttributeDefinition` in the `derived` namespace, carrying the store's real options and limits, so a size question offers the store's variant values and a name question carries the store's length limit. Configuring a second product adds only the fields the first did not already cover: two products that both name a printed name share one definition by key, so the survey asks it once. The merged set of derived definitions is the survey.

**Issuing the survey.** Approving an attendee (`set_approval` with `approved`, or the automatic path the setting names) marks the attendee approved and issues a survey request for the definitions their configured products need. The request reaches the attendee through the reminder channel in Settings; email delivery is the channel, and it ships in the same future release as payment authorization, so the demo issues the per-attendee survey link and shows it in the app.

**Variant mapping.** When the organizer selects a Shopify product, its option values arrive from `get_product`. Tokuchu matches each option value to a survey answer by label through a synonym table; Tokuchu shows an unmatched option to the organizer to map by hand or leave as the default variant. This step makes no model call.

**Personalization mapping.** `set_personalization_mapping` validates each row against the product's field schema and the event's definitions before storing: the field must exist, every required field must have a mapping, a definition source must exist and match the field's scope, the source's value type must fit the field's kind, and a transform must fit its source. Each failure returns a code (unknown_field, unmapped_required, unknown_definition, scope_mismatch, incompatible_type, incompatible_transform) and a message naming the row. The kind and transform compatibility tables are data rows in the code, so a new kind or transform is a row, not a branch. When a survey field key matches a vendor field key, Tokuchu writes the mapping without asking.

**Resolution.** Each manifest read resolves every mapped field per approved guest: the source's raw value (the attendee's answer, the event field, or the literal), then the transform, then the field's checks (a date field needs an ISO date, a word_list needs words, a length limit, an allowed-value list). A row grades ready when every field resolves, incomplete when a source or value is missing, and invalid when a value fails its field. A missing value passes through a transform untouched, so the issue names the real cause.

**Quantity and variant derivation.** A batch's recipients filter (default `status = going AND approval = approved`) selects guests. The quantity per variant counts the matches mapped to that variant; a guest with no value takes the default variant or the organizer's fallback, or the non-responder rule skips the unit. Counts recompute on every write until the cutoff, and each recompute that changes a quantity queues one `update_cart`.

**The cutoff.** The cutoff fires when signups close, a fixed period after that, or on the organizer's manual trigger, as the setting names. At the cutoff Tokuchu freezes the order list, marks every value a batch reads as locked through `locked_definition_ids`, and audits each unit as ready, incomplete, or excluded. A locked value rejects a later attendee edit and shows the organizer the change path. A non-responder's unit is skipped or held as the non-responder rule decides, and the audit names each skipped unit and its attendee.

**Cancellations.** A status change to can't go or a withdrawn approval appends a change-log entry. Before the cutoff it lowers the variant's quantity and queues `update_cart`. After the cutoff the organizer's choice on the plan screen applies: keep the unit (cancelled_sunk), reassign it to a maybe (cancelled_reassignable), or drop it when the checkout's terms allow.

## 8. The loop call by call

The loop uses three kinds of call: a WebMCP tool call in the page, a Tokuchu API call on the same origin, and a Shopify call from server to shop.

**Draft, publish, signups, approval.** `POST /api/events`, `POST .../publish`, then attendees `POST .../rsvp` and `PATCH .../rsvp/:guestId`, and the organizer `POST .../guests/:guestId/approval` or the automatic path. Approving a guest issues the survey request. The dashboard polls `GET /api/events/:id` for the snapshot. This stage makes no Shopify call.

**Configuring merchandise.** The Merchandise tab sends `POST /api/events/:id/search` with a card key or a sentence; the discovery search of Section 10 answers with ranked candidates. The organizer picks a product; `configure_product` reads its schema and derives the survey fields; `set_personalization_mapping` stores the mapping, implicit where keys match.

**Collecting the survey.** Each approved attendee opens their survey link and submits answers through `PATCH .../rsvp/:guestId`, which writes the derived-definition values. Adding a product after some attendees answered issues a follow-up request for only the new fields.

**Cutoff and audit.** At the cutoff Tokuchu freezes the list, locks the values, and produces the manifest with each unit's status and issues. The Overview shows the ready, incomplete, and excluded counts and names each skipped attendee.

**Sending and keeping a Shopify cart current.**

1. `POST .../send`: the agent calls `create_cart` at the shop with one line per variant at its quantity, the organizer's email and phone as buyer, and the delivery target as destination. The priced cart comes back; Tokuchu stores `cart_id` and shows the proposal.
2. `POST .../approve`: the organizer approves the plan; Tokuchu sets the lock date from the delivery window and the vendor's lead time.
3. Until the lock date, every write that changes a quantity triggers `update_cart`; `get_cart` on each poll detects a dropped line and raises a follow-up.
4. At the cutoff: `create_checkout` from the cart; values lock; the order is placed as Section 9 describes. Tokuchu stores `checkout_id`.
5. After the order: `get_order` on each poll; the dashboard shows the status.

**An order on a print-shop design.** The same send, approve, and sync operations run through the shop's tools instead of a cart. Send builds one unit per counted manifest row, calls `create_batch`, and orders it when `validate_units` finds no issue; a unit the shop cannot print becomes an Overview follow-up naming the attendee. Approve accepts the proof and locks the plan, including the printed-name definition so a later edit cannot diverge from the approved proof. Each poll reads the shop's `get_changes` and writes the new entries into the gift's thread.

**Personalized units on the custom shop.** For a product on the custom shop, the vendor execution agent (`scripts/personalize-agent.ts`) reads the personalized manifest from Tokuchu's MCP endpoint and produces the whole batch on the live storefront through the Customily adapter's three batch tools (`get_personalization_schema`, `validate_personalized_batch`, `create_personalized_batch`). It configures one unit per ready row, reloading the product page between units so each Customily location control resolves on a fresh page, and it posts one update carrying the checkout URL and the per-recipient preview URLs. The tools accept a Shopify GID or a bare product id. Section 9 describes the order the run then places.

**Vendor progress, both directions.** Once a batch is approved, the organizer or Tokuchu issues a token for that gift. A Shopify shop reports through `get_order`; a vendor with its own agent posts `get_manifest`, `get_changes`, and `post_update` on its own schedule, and the organizer's replies return on the vendor's next `get_changes`. The dashboard shows one thread per gift. An organizer reply on a print-shop gift forwards to the shop's `post_message`, so the shop's own thread carries it.

## 9. Payments and spend authorization

Two movements of money reach an event: the organizer pays the vendor for the merchandise, and, in a future release, attendees pay for tickets. One rule governs both: Tokuchu never stores or reads a card number. The card is captured by a payment provider whose fields Tokuchu never renders, and Tokuchu holds only a reference, a status, and the bounds the organizer set.

**Paying the vendor.** The secure form uses a delegated payment token under the Agentic Commerce Protocol, which OpenAI, Stripe, and Meta maintain, and which Shopify's Universal Commerce Protocol composes with through the Agent Payments Protocol. The sequence:

1. **Authorize once.** The organizer saves a payment method in the provider's hosted fields and sets a mandate: an amount cap, a store whitelist, and an expiry. Tokuchu stores the provider reference and the mandate as a `PaymentAuthorization` record. No card number reaches Tokuchu.
2. **Request a scoped token.** At the cutoff, for the confirmed order list, Tokuchu asks the provider for a Shared Payment Token scoped to the vendor and the batch amount, at or under the mandate cap, with an expiry. The token is single-use and constrained by that amount and expiry.
3. **Complete the vendor checkout with the token.** Tokuchu hands the token to the vendor's UCP checkout, and the vendor's payment provider charges a payment intent from the token. No card is typed.
4. **Reconcile.** Order confirmations and status arrive by webhook; Tokuchu records the order id and status. Steps 2 to 4 run within the mandate, so unattended ordering cannot exceed the amount, the stores, or the expiry the organizer set, and the organizer can revoke the mandate.

Step 3 depends on the vendor store accepting a delegated payment token over UCP. When a store offers that path, Tokuchu orders unattended within the mandate. When a store offers only its standard checkout, the secure alternative is the organizer completing the store's own hosted checkout, whose card fields render in Shopify's PCI iframes (Section 3), so Tokuchu still never sees the card; the organizer completes that path by hand.

**Collecting from ticket buyers.** A paid ticket routes through Stripe Connect, whose hosted checkout keeps Tokuchu out of PCI scope and pays out to the organizer. A free ticket collects no money, and a free-ticket holder still receives merchandise, so ticket sales and the merchandise order stay separate.

**In this release.** The Payment panel is present and greyed, and it moves no real money. The demo places its order on a store in test mode, where Shopify's own test card completes the checkout, so the loop reaches a placed order without a real charge. Real payment authorization, the delegated token, and paid ticketing ship as the future features the panel names.

## 10. Product discovery and ranking

Discovery finds the products the organizer configures. It runs in two stages over every configured source, and it ranks the results so the organizer picks from the top. In this release the sources are the Shopify Global Catalog, the print shop, and the organizer's own custom shop behind `CUSTOMILY_SHOP_URL`; the search discovers WebMCP stores, and the custom-shop source is scoped to the organizer's store because it answers the UCP and Customily endpoints.

### Inputs

- Event record: the delivery target (the address and the needed-by date), cost per person, the approved count.
- Organizer intent: a card or a sentence. A card marked personalized, or a sentence naming a name or a personalized item, marks the request personalized, and the coverage term of Stage 2 reads that mark.
- The configuration row: delivery buffer in days (3), lead-time cap in days (14), the term weights.
- Per candidate, from its source: variants and option values, the delivery window or the refusal, the seller's policy links, availability.

### Stage 1: eligibility

A product passes only if every rule holds, and the first failing rule is the reason the results screen gives.

1. Ships to the target: a checkout probe the shop refused excludes the product, with the shop's message as the reason.
2. Delivery: a probe that returned a window passes only when the window's latest date plus the buffer falls on or before the needed-by date. A probe that returned no window leaves the product eligible with delivery unknown and a scoring penalty.
3. Price: the unit price falls at or under the budget.
4. Availability: at least one variant is available.

Quantity limits surface later: Shopify publishes no minimum or maximum, so a `create_cart` error at send time signals the limit, and the print shop's `quote_batch` refuses below its minimum before ranking.

### Stage 2: scoring

Each eligible product receives a score from weighted terms, each normalized to 0 to 1:

- Coverage: for a personalized request, 1 when the candidate carries a personalization field of kind name and 0 otherwise, so a product that cannot print the name ranks below one that can; for any other request, 1 (weight 30).
- Lead-time margin: days between the window's latest date and the needed-by date, capped at 14; 0 when the window is unknown (weight 25).
- Price fit: 1 when the unit price is between 60% and 100% of the budget, falling to 0 at a price of nothing, 0 above the budget (weight 20). The amount is a budget to spend, so a cheaper product does not outrank one that uses it.
- Delivery confidence: 1 for a dated window from the checkout, 0.5 for a duration, 0 for unknown (weight 15).
- Cancellation terms: 0.5 when the seller carries a refund-policy link, 0 otherwise (weight 10).
- Seller signal: 0.4 for a public shop URL, 0.3 for four or more policy links, 0.3 for a delivery window from the probe (weight 5).

Weights live in the cards configuration row. The top five fill the results screen; Show 5 more extends the list.

### Assignment and resolution

A gift plan holds an ordered list of rules, each a filter in the standard grammar and a product. The first rule whose filter matches a guest assigns that guest's product. The default plan carries one rule: `status = going AND approval = approved` receives the configured product. Section 7 resolves each guest's variant and unit status on every read, and the organizer can override a guest's product or variant in the attendee table.

## 11. The category cards and the catalog

The Merchandise tab offers four cards (Gift sets, Food & drink, Apparel, Stationery) and a sentence box. Each card maps to a configuration row holding one or more searches: a query string and, where one fits, a Shopify taxonomy id in the `categories` filter. The favor survey in `spikes/favor-vendors/` ran 24 queries for New York (shops located in the US) and for Toronto (shops located in Canada, shipping to M6H), and the stationery survey in `spikes/stationery/` ran the personalization queries.

**The `categories` filter takes taxonomy ids.** Shopify's Standard Product Taxonomy ids returned matches where the category names returned nothing: `ae-2-1` (Party Supplies), `fb` (Food, Beverages & Tobacco), `aa` (Apparel & Accessories), `os` (Office Supplies), `tg` (Toys & Games), `hg` (Home & Garden), `bu` (Bundles). A result carries no category field of its own, so the caller sends the id and cannot learn it from a result. `price_tier` returns a different slice of the same query per tier.

| Card | Searches (query, taxonomy id) | Sources |
| --- | --- | --- |
| Gift sets | "gift sets" with `bu`; "party favors" with `ae-2-1` | shopify |
| Food & drink | "dessert box gift", "cookie favors", "chocolate favor box" with `fb` | shopify |
| Apparel | "tote bag gift", "t-shirt favors" with `aa` | shopify, customshop |
| Stationery | "sticker sheet", "stationery gifts", "personalized stationery" with `os` | shopify, printshop |

The catalog reads the price ceiling in minor units (cents), the unit it returns prices in, so Tokuchu sends the cost per person in cents. A search for Food & drink to Toronto under $18 returns 74 distinct products, 56 of which pass every rule. Five products in 1,189 New York rows carry an option a name could go in; every other personalized product takes the name somewhere the cart cannot carry, which is why a printed name travels the manifest, the print-shop unit, or the custom-shop adapter rather than a cart line (decision 1 in Section 13).

## 12. Integration tests

In the page: Playwright opens the dashboard with `?webmcp=polyfill`, and `await document.modelContext.getTools()` returns the tool names of Section 6. Executing `get_summary` returns the seeded counts, `set_gift_plan` changes the derived quantities on the page, and a write against another event's id returns `isError: true` and changes nothing.

Over HTTP: `tools/list` at `/api/events/{id}/mcp` returns the same names. With a vendor token, `get_manifest` returns only that token's gift and readable definitions, `list_guests` returns `isError: true`, and `post_update` with kind `confirmed` appears on the dashboard's thread and in `get_changes` within one poll. With no token every call returns `isError: true`.

The CurationAgent runs under vitest against a scripted model and an injected search, so a run stores real mappings and builds a real proposal without the catalog or the OpenAI API. The Printshop workspace's demo suite records the Tokuchu-to-print-shop path end to end. Two live suites, gated by `LIVE_CUSTOMILY=1`, cover the custom shop: a smoke test of the storefront adapter's tools, and the three experiments of the integration spec (per-guest lettering, the event-level star map, and mixed personalization where the guest's size answer picks the Shopify variant), each building its own event, running the vendor execution agent, and reaching a placed test order on the store.

## 13. Decisions taken

1. **Names travel outside the cart.** A Shopify cart carries variant and quantity only, so a printed name travels on three paths: the print shop takes it in each unit's values, the custom shop takes it through the storefront adapter's tools, and any vendor with a token reads it from the manifest when the organizer makes that definition readable.
2. **The organizer pays for the merchandise.** The organizer funds the whole order rather than collecting shares from attendees. A ticket, free or paid, gates attendance, and a free-ticket holder still receives merchandise, so ticketing and merchandise funding stay separate.
3. **Per-attendee shipping is a setting.** The event ships every unit to one address, or the survey collects each attendee's address and ships to each person.
4. **The survey fields merge.** A field two products share is asked once, so an attendee answers a printed name a single time however many products carry it.
5. **Approval and non-responders are settings.** Approval fires automatically on signup or waits for the organizer. A non-responder's unit is skipped or held at the cutoff, never filled with a guessed value.
6. **Authorized spend, optionally auto-executed.** The organizer authorizes the spend once through a mandate, and Tokuchu orders within it unattended, or the organizer places each order. Section 9 gives the secure form.
7. **Discovery scoped to the configured store.** Discovery searches WebMCP stores; the custom-shop source runs against the organizer's own store because it answers the UCP and Customily endpoints.

## 14. MVP boundary

The MVP covers one event with sample attendees; attendance by RSVP or free ticket; organizer approval, automatic or manual; a survey derived from the configured products' schemas through WebMCP, with each field's options read from the store and shared fields merged; per-attendee survey collection until a cutoff that fires on close, after a period, or manually; the audit that grades each unit ready, incomplete, or excluded and skips a non-responder per setting; product discovery against the live Global Catalog with delivery probes and the print-shop and custom-shop sources; a real cart at the chosen shop updated on every quantity change until the cutoff; a print-shop batch from units through proof to delivered; the custom shop's batch reaching a placed test order; the tools of Section 6 in the page and at the MCP endpoint with vendor tokens; a scripted vendor agent that reads the manifest and posts a confirmation and a shipped update. The Payment panel is present and greyed, payment authorization and paid ticketing are future features, and the order places in test mode, so no real money moves.

The video demo runs in this order: create the event, configure a personalized product from the store search, open the survey as an approved attendee and answer the derived fields, reach the cutoff and read the audit, send the batch and watch the cart or the custom-shop units fill, place the test order, then watch the vendor's confirmation arrive on the dashboard.
