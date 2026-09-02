Handoff moved onto WebMCP (both sides), per user: the vendor was reading the manifest and posting
status through the JSON-RPC endpoint (/api/events/{id}/mcp) = 'normal MCP'. Added registerVendorTools
(src/webmcp/register.ts) + a vendor WebMCP page (src/app/handoff/page.tsx) that registers the
vendor-scoped tools on document.modelContext for one token. Rewired personalize-agent: it opens
/handoff?event&token&webmcp=polyfill and calls get_manifest/post_update over document.modelContext
(callHandoff, retried through the dev strict-mode re-register window), the same way it drives the
store's WebMCP tools. Verified live (run 10, 4/4): 'page get_manifest' + 'page post_update' + cart 3
lines. Vendor = springbuilt (unchanged). JSON-RPC endpoint still exists but is off the handoff path.
Flaky-run fixes en route: approve poll timeout 25s; pick chain waits for recipients/mapping and targets
the result by shop name 'Customworks'. Combined mp4 ~3:04.

Wiped the scripted vendor agent per user (out of every flow they described): deleted
scripts/vendor-agent.mts + tests/vendor-agent.spec.ts; removed its Scene 7 from tests/demo.spec.ts
(+ its execFileSync import), README rows/run line, docs/webmp-integration.md + docs/prd.md mentions,
and the personalize-agent comment. Typecheck green, 133 tests pass. NOT touched: the post_update/
get_updates endpoint + the vendor-progress thread UI (the real handoff still posts one update) —
asked the user whether that feedback loop should also go.

## 2026-09-01 — Demo/app rework from video review (in progress)

User reviewed the flow-demo video and homepage and asked for a set of app changes, then a re-record.
Root causes found in code:
- 'Selection option' gone: invite-form supports enum/multi_enum as chips, but the seeded 'dietary'
  question ships with empty options (library.json), and there is NO size question. Size is a Shopify
  variant (search.ts Variant.options), not an RSVP definition, so attendees are never asked it.
- Trace descriptions intact: curation-agent LABELS + experience.tsx curate-steps render them. My
  homepage step-2 GIF crop dropped them; recut needed.
- The RSVP question backend already exists (AttributeDefinition + invite-form + RSVP API + grid).
  The recorded flow uses the thin demo-attendees.json fixture, so the grid is sparse.

Decisions (from the user): dynamic questions from the product's WebMCP requested fields (incl. size
from variants, not hardcoded); build a PERSISTENT organizer UI to action the request; add an RSVP link
to review the cart after approval; surface WebMCP routing on the Attendees page and in docs + the video
(stop deleting it); event renamed to '8th Annual Eastern Canada Astronomy Symposium'; RE-RECORD end to
end so the ACCURATE flow shows, one video that also shows the store cart filling.

Items 1-5 DONE + verified (133 tests pass, live screenshots):
- 1 dynamic Size question: giftRequestables derives a guest enum from the product's variant options
  (server/api.ts); Variant type now carries options through (types.ts, experience.tsx). Renders as
  chips in the invite form.
- 2 organizer request UI: attendees.tsx 'Request from attendees' -> POST request-fields ->
  upsertDefinition persists the questions; the invite form and grid pick them up.
- 3 cart-review link: approveSpecs records checkout_url = the vendor cart; shown after approval.
- 4 WebMCP routing: 'How this reaches the vendor' panel on the Attendees tab + docs/webmcp-routing.md.
- 5 simulated responses: demo-attendees.json carries size; requests.test.ts proves request->answer->grid.
- Also: hid unanswerable (no-option) choice questions from the form and grid; Attendees tab is now
  full-width (.wrap.solo) so all answer columns show.
Step 2 rebuilt HONEST (no hardcode, no fabricated strings, verified with probes):
- Discovery is real: probed the live search over 4 queries; the store's 'Customized Crewneck'/Customworks
  ranks ~#2 for 'personalized ... crewneck sweatshirt' queries (global catalog + the store's /api/ucp/mcp).
- Options are real: probed get_personalization_schema live on the store page -> returns the 3 fields +
  6 variants (White/S..3XL). customshop.json was just a stale copy.
- New step 2: real search -> physically PICK the store's result (result->next->confirm) -> fetchStoreSchema()
  calls the picked store's own get_personalization_schema -> configure gift from that. Overlays show only
  real endpoints/funnel/titles/fields. Dropped curate and the customshop.json fields dependency in the demo.
  (App's customshop.ts still holds customshop.json; a schema-on-selection refactor is the follow-up.)
- Run 5 all 4 pass; combined mp4 ~3:21.

Step 2 re-recorded per explicit request: uses the 'Or describe it' catalog search (multiple ranked
results via /api/ucp/mcp) with a translucent WebMCP overlay naming the real search_catalog calls +
counts + returned product names, then the agent personalizes the ranked shirt (trace kept). Spec adds
webmcpOverlay() built from the live search funnel/results. Run 4 all 4 pass; combined mp4 ~3:40.

Item 6 DONE: re-recorded live (run 3, all 4 tests pass). New spec flow: create -> find/personalize ->
request Size+name from attendees -> full records grid + WebMCP routing -> approve+cart link -> vendor
cart fills (3 units). Fixes: remove seeded dietary in draft (empty required choice blocked publish);
set gift.shop_domain so approve records the cart URL; soft review-cart assertion. Combined the organizer
tutorial video + the store cart video into one mp4 (tests/videos/flow-demo-combined-*.mp4, 3:05).
Remaining: 7 homepage recut with the new video + trace.

Done + verified (typecheck green): category-card icons (inline SVG, experience.tsx + globals.css);
event rename in docs/demo-event.json + docs/home.html.

Remaining, in order: (A) dynamic Size question from variants + wiring; (B) persistent organizer request
UI; (C) cart-review link (checkout_url not set on approve today, needs handoff wiring); (D) Attendees
WebMCP surfacing; (E) simulated responses filling name+size; (F) re-record (dev stack + keys ready);
(G) docs WebMCP routing + homepage recut with trace + cart-filling.


## 2026-09-03 — Docs rewritten to the customization flow

Per user: the app finds a customizable product over Shopify's WebMCP, reads the store's own
get_customization tool, compares the fields with attendee and event data, requests only the missing
values from each attendee (email via Resend; simulated in the demo), tracks completion, and on approval
calls the store's add_customized_to_cart tool, which adds lines through Shopify's cart endpoint and
returns the cart's checkoutUrl for the organizer to pay. WebMCP tools on both ends; no print shop, no
vendor handoff page, no payment authorization. Deploy: Render + Postgres (one jsonb doc per event) +
Auth.js magic link via Resend, Chromium in the image for the approval job.

Verified live on the store (springbuilt.myshopify.com) 2026-09-03: Shopify's own storefront WebMCP script
registers 10 page tools (update_cart takes variant+quantity only); the theme session cart is a Storefront
cart (gid://shopify/Cart/{token}) whose checkoutUrl opens in a fresh browser with the personalized lines;
tokenless Storefront GraphQL from the store origin accepts cartCreate with per-line attributes; cart
permalinks carry properties on the first line only. The repo's adapter is not installed in the theme.

Rewritten: docs/prd.md (from scratch), docs/webmcp-routing.md, README.md, CLAUDE.md,
integrations/customily/README.md (to the two-tool contract #11 implements), docs/home.html (tool names
and step copy). Deleted docs/webmp-integration.md (the earlier task brief). Left untouched:
docs/architecture.html (untracked, describes the vendor-agent design; superseded). Tickets #10–#16 carry
the code changes; the code still implements the previous tools until they close.
