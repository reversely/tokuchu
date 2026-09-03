# Agent playbook

This document gives a browser agent, or a terminal agent with a browser tool, the prompt and the steps to run one gift order through Tokuchu and the demo store. It applies to a Tokuchu server in static mode (`TOKUCHU_STATIC=1`), where the server makes no catalog search and opens no store page of its own; every capability is a WebMCP tool on a page, and the agent moves between Tokuchu's pages and the store's product page. `scripts/agent-playbook.mjs` follows the same steps with Playwright in place of a model, so a judge can repeat either path.

## The task

The organizer has published an event and the attendees have replied going. The agent reads the store's customization contract for the crewneck on the store's product page, hands it to Tokuchu, has Tokuchu ask each attendee only for the values the RSVP list lacks, waits until every attendee's row reads ready, approves, takes the cart items Tokuchu prepares back to the store's page, fills the store's cart with one line per attendee, and records the checkout link on the gift. The store's own agent then reads the manifest through a signed link and posts its updates.

## The two pages

| Page | URL | Session | Tools |
|---|---|---|---|
| Tokuchu event page | `https://<tokuchu host>/events/<event id>` | An organizer session (sign in with an email address) or the demo guest link `https://<tokuchu host>/demo`, which creates a guest event and lands on it | `list_guests`, `set_gift_plan`, `set_gift_customization`, `get_requirements`, `set_personalization_mapping`, `request_from_attendees`, `list_missing`, `get_fulfillment_manifest`, `approve_specs`, `post_update`, `get_updates`, `get_changes` |
| Customworks product page | `https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt` | None | `get_customization`, `add_customized_to_cart`, and Shopify's storefront tools |

The Tokuchu page shows the store's URL, the product handle, the gift id, and the next tool on each side on its handoff card, and its Agent notes block and the `tokuchu-agent-task` meta tag carry the order below. The attendee's invite page (`/i/<code>?guest=<guest id>`) registers `submit_rsvp`, and the store-facing page a grant's signed link opens registers the grant's tools.

## Listing and calling a page's tools

Every page registers its tools on `document.modelContext`. In a browser with native WebMCP support the object exists on load; in Playwright's Chromium or another browser without it, open the Tokuchu page with `?webmcp=polyfill` on the URL, and inject `src/webmcp/polyfill.js` as an init script before the store's page loads.

List the tools:

```js
(await document.modelContext.getTools()).map((t) => t.name)
```

Call one and read its text payload:

```js
JSON.parse((await document.modelContext.executeTool((await document.modelContext.getTools()).find((t) => t.name === "list_guests"), { filter: "status:eq:going" })).content[0].text)
```

A failed call returns `isError: true` and a payload `{ error }` whose text names the field, the record, the limit, or the revisions involved; the table below says what each means.

## The order of operations

1. On the Tokuchu event page, list the tools and read the guests with `list_guests` `{ filter: "status:eq:going" }`.
2. On the store's product page, call `get_customization` `{ product_id: "10242071789817" }`. The payload carries the product id, the title, the fields (key, label, kind, required, constraints), the variants with their numeric ids, and the selected variant. Keep the whole payload.
3. Back on Tokuchu, call `set_gift_plan` without a `gift_id`: `{ rules: [{ filter: [{ field: "status", op: "eq", value: "going" }], product_id: "10242071789817" }], shop_domain: "springbuilt.myshopify.com", product_title: <the title>, product_url: <the product page URL> }`. The reply is the gift with its `id`.
4. Call `set_gift_customization` with `{ gift_id, ...payload }`, the payload from step 2. The reply's `personalization.fields` and `variants` are the store's.
5. Call `get_requirements` `{ gift_id }`. Each requirement names its `source`: `guest` or `event` or `literal` or `definition` for a value Tokuchu already fills, and `question` for one the attendees must give. The name field resolves from the RSVP name.
6. Call `request_from_attendees` `{ gift_id }`. It turns each question into a guest question with the store's limit or choices and records a request to every going attendee who lacks an answer. Read `get_requirements` again and, to confirm the rows, call `set_personalization_mapping` `{ gift_id, mappings }` with one row per non-variant requirement: the requirement's `mapping` when it carries one, else `{ vendor_field_key: <key>, source: { type: "definition", definition_id: <definition_id>, subject_scope: "guest" } }`.
7. For each guest question the event now holds (`scope: "guest"` and `required_rule: "going"` in the event snapshot at `GET /api/events/<id>`), call `list_missing` `{ definition_id, filter: "status:eq:going" }`. Ask only the attendees it names, and only for those questions. An attendee answers on the invite page through `submit_rsvp` with `guest_id` and one property per question key, or through the form.
8. Read `get_fulfillment_manifest` `{ gift_id }` until every attendee's `status` reads `ready`. The reply's `cart_items` array has one item per ready attendee: `recipient_ref`, `variant_id`, and `values` keyed by the store's field keys.
9. Call `approve_specs` `{ gift_id }`. The reply carries `approved_at`; no cart job runs in static mode, so `cart_fill` and `checkout_url` stay empty.
10. Read `get_fulfillment_manifest` once more and take its `cart_items` to the store's product page. Call `add_customized_to_cart` `{ items: cart_items, idempotency_key: "<gift id>:<approved_at>" }`. The reply lists the `ready` lines and a `checkout_url` that opens the cart at checkout in any browser. A repeated call with the same key adds nothing.
11. On Tokuchu, call `post_update` `{ gift_id, kind: "in_production", text: "The cart is ready to review", reference: <checkout_url> }` so the gift's progress log carries the link.

## The store's side

The organizer creates store access on the Attendees tab (Share fulfilment data), or through `POST /api/events/<id>/grants` with `{ procurement_id: <gift id>, grantee_type: "agent", grantee_id: <store>, permissions: ["manifest:read", "requirements:read", "changes:read", "updates:read", "updates:write"], allowed_attribute_ids: [<definition ids>] }`. The reply's `link` is a signed path; opening it sets the store session and lands on `/store/<grant id>`, which registers the grant's tools.

1. `get_procurement` `{ procurement_id }` reads the status and the current and approved revisions.
2. `get_fulfillment_manifest` `{ procurement_id }` reads one row per attendee with the values the grant allows.
3. `post_procurement_update` `{ procurement_id, type: "accepted", reference: <order reference> }` moves the order on; `production_started` and `fulfilled` follow. `needs_information`, `invalid_value`, and `option_unavailable` with `attendee_ref` and `requirement_id` open an exception the organizer sees and ask the attendee again by email with the `message` quoted.
4. `get_changes` `{ procurement_id, after_revision: <the revision last read> }` lists what changed since, and `acknowledge_changes` `{ revision: <the current revision> }` records how far the store has read.

## What each error means

| Error text | Meaning | What to do |
|---|---|---|
| `No gift <id> on event <id>.` or `No gift <id>.` | The `gift_id` names no gift on this event | Use the `id` the `set_gift_plan` reply returned |
| `No guest <id> on event <id>.` | The `guest_id` or `attendee_ref` names no attendee | Use an `attendee_ref` from the manifest or an id from `list_guests` |
| `product_id: Invalid input ...` on `set_gift_plan` | The first rule carries no `product_id` | Put the store's product id in the first rule |
| `set_gift_customization takes the get_customization payload: fields: ...` | The payload is not the tool's shape | Pass the payload exactly as `get_customization` returned it |
| `product_id <x> is not gift <id>'s product <y>.` | The payload names another product | Call `get_customization` for the gift's product |
| `fields: none of the N fields has a kind Tokuchu resolves (...)` | Every field has a kind Tokuchu cannot fill | Check the store's field kinds against the list in the message |
| `Gift <id> has no personalization schema; call set_gift_customization ...` | Mappings were sent before the store's fields | Run step 4 first |
| `unknown_field: the product has no field <key>` or `unmapped_required: <label> needs a mapping` | A mapping names a field the store lacks or leaves a required field without one | Map every required field to a source and use the store's keys |
| `<label> allows N characters; this has M.` or `<label> must be one of: ...` | An answer is outside the store's limit or choices | Send a value within the limit or one of the listed choices |
| `No question <id> on this event.` | An answer names a definition the event lacks | Use the definition ids from the event snapshot or the keys the `submit_rsvp` schema lists |
| `The cart job for gift <id> is still running; approve again once it settles.` | A cart job from normal mode is running | Wait and approve again |
| `search_gifts is off in static mode ...`, `send_to_vendor is off in static mode ...`, `approve is off in static mode ...` | The tool needs the server to reach the store | Pick the product on the store's page and follow this playbook |
| `revision: a whole number of 0 or more is required.` or `Revision N is past the current revision M.` | The acknowledgement names no revision or one ahead of the manifest | Acknowledge the revision of the last manifest or change list read |
| `grant_id names the grant to acknowledge for.` | The organizer's token acknowledged without naming a grant | Pass the grant id, or call from the store page whose token carries it |
| `invalid_value names the attendee and the requirement.` | The update lacks `attendee_ref` or `requirement_id` | Name both from the manifest |
| `The token may not call <tool>.` | The grant's permissions leave that tool out | Ask the organizer for the permission, or use the tools the page lists |
| `one or more items are invalid and nothing was added` from the store | An item's `values` breaks a field's rule; the reply lists each item's issues | Fix the value on Tokuchu (the attendee answers again) and re-read `cart_items` |

## The prompt for a terminal agent with a browser tool

Paste this into an agent that has a browser tool (Playwright MCP or a coding agent's browser), after filling the three angle-bracket values:

```
You are operating two web pages through their WebMCP tools. Do not fill forms; call the tools.

Tokuchu event page: <TOKUCHU_EVENT_URL>?webmcp=polyfill
Store product page: https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt (product id 10242071789817)
Polyfill for the store page: the contents of <PATH_TO_REPO>/src/webmcp/polyfill.js, added as an init script before the page loads.

On each page, list the tools with (await document.modelContext.getTools()).map((t) => t.name) and call one with document.modelContext.executeTool(tool, args); read JSON.parse(result.content[0].text). A result with isError true carries { error } whose text names what to change.

Follow this order and stop at the first error you cannot resolve by reading it:
1. Tokuchu: list_guests { filter: "status:eq:going" }.
2. Store: get_customization { product_id: "10242071789817" }. Keep the whole payload.
3. Tokuchu: set_gift_plan { rules: [{ filter: [{ field: "status", op: "eq", value: "going" }], product_id: "10242071789817" }], shop_domain: "springbuilt.myshopify.com", product_title: <title from step 2>, product_url: <the store product page URL> }. Note the gift id.
4. Tokuchu: set_gift_customization { gift_id, ...payload from step 2 }.
5. Tokuchu: get_requirements { gift_id }, then request_from_attendees { gift_id }, then get_requirements again and set_personalization_mapping { gift_id, mappings } with one row per non-variant requirement (its mapping, else a definition source on its definition_id).
6. Tokuchu: for each guest question the event snapshot at GET /api/events/<id> lists with required_rule going, list_missing { definition_id, filter: "status:eq:going" }. Report who is missing what; the attendees answer on their invite pages through submit_rsvp.
7. Tokuchu: get_fulfillment_manifest { gift_id } until every attendee reads ready. Then approve_specs { gift_id }, then get_fulfillment_manifest again and keep cart_items.
8. Store: add_customized_to_cart { items: cart_items, idempotency_key: "<gift id>:<approved_at>" }. Report the checkout_url.
9. Tokuchu: post_update { gift_id, kind: "in_production", text: "The cart is ready to review", reference: <checkout_url> }.

Report each tool call you make and a one-line summary of its result, then the checkout link.
```

## The scripted run

`npm run agent-playbook` runs `scripts/agent-playbook.mjs`: it creates and publishes an event through the API with the three attendees of `tests/fixtures/demo-attendees.json` replying going, then follows the steps above through the pages' WebMCP tools with the polyfill, including each attendee's `submit_rsvp` on their invite page and the store's side through a grant's signed link. It prints each tool call with a summary of its result and writes one video per page into `tests/videos/agent-playbook-*.webm`. It needs a static server: `TOKUCHU_STATIC=1 npm run dev -- -p 3114`, or another address in `AGENT_BASE`, and the network for the demo store.
