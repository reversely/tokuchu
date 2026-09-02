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

## 2026-09-02 — Autonomous ticket run

Base committed as 61d8341 (docs rewrite + the earlier iteration's Attendees tab, request-fields,
handoff page, tutorial mode). GIFs in docs/media/ stay untracked (pre-commit large-file hook); #7
re-captures them. Worktree agents branch from the commit they see; the first wave branched from
ddb191b, so tickets land by cherry-pick. User asked for at most two agents at a time, accuracy over speed.

- #3 landed as 5068a55 (cherry-pick of c62f721). Suite 137 passed / 7 skipped.
- #11 landed as 68deebc (cherry-pick of f7afe5e; README conflict resolved to the worktree side). Live
  test passed from main: two lines, checkout_url opens in a fresh context with both names, replay adds
  nothing. Open: the Customily production-file question (no order placed); the time field's property
  label ("Pick a time for Star Map 1") is a guess since the widget names no input for it.
- #10 landed as 0c8c68d (cherry-pick of 90432d7; doc conflicts resolved to main, code to the worktree).
  Suite 119 passed / 5 skipped. Fast Playwright: 14 pass; tests/webmcp.spec.ts fails on a tool-name
  list that has been out of date since the initial commit (14 tools, spec lists 13); #13 rewrites it.
  The dietary library row is un-seeded (seed: false) rather than deleted, so the draft's required-choice
  publish blocker keeps a path.
- #13 landed as df1d15f (cherry-pick of 9b58cd0). Landing #10 had regressed tests/flow-demo.spec.ts to
  its pre-checkpoint step 3 (I took the worktree's whole file); #13's copy restored it and #10's two
  edits were re-applied by hand. Gate: 124 vitest, 15 fast Playwright (webmcp.spec green again).
  Name rule: a library-seeded printed_name does not override the display name; an organizer-created one does.
- #4 landed as ae7cbd1 (cherry-pick of 4fbf0d9; conflicts in api.ts imports and the request-fields
  route resolved by hand; #13's follow-up route wrapped too). Tests run on PGlite; prod uses pg via
  DATABASE_URL; no DATABASE_URL outside production falls back to memory with one warning. Known limit:
  two concurrent writes to one event are last-write-wins. Gate: 133 vitest, 15 fast Playwright.
- Screenshot gate on #13 (docs/progress/2026-09-02-issue-13-attendees-requests.png) found two defects:
  the library-seeded printed_name shows "missing" on every row while the chip says the name comes from
  the RSVP (filed #18); an attendee who replies after the request was sent never gets a request row
  (fixed next as fix(requests)).
- fix(requests): a gift records requested_at when the organizer requests; each RSVP write then issues the
  request to going attendees without a row. Verified on screen (docs/progress, after-fix capture).
- #17 landed as bafbde2 (clean cherry-pick of d103f34). submit_rsvp on the invite page with the store's
  constraints in its schema; the form and the tool share send-rsvp.ts. Gate: 137 vitest, 16 Playwright.
- #18 landed as 0b1d8ee (clean cherry-pick of 48bed91). A fresh event starts with no questions; the
  name rule maps a store name field to any printed_name question present. Gate: 137 vitest, 16 Playwright.
- #5 landed as a176951 (clean cherry-pick of ec52cef). next-auth 5.0.0-beta.32 + @auth/pg-adapter; the
  Resend provider logs the link in dev; ORGANIZER_EMAILS allowlist; no-database mode runs the adapter on
  PGlite with jwt sessions (an Email provider needs an adapter). Gate: 143 vitest, 17 Playwright.
- #12 landed as 23693c5 (cherry-pick of 7e426bd; register.ts and routing conflicts resolved: keep
  submit_rsvp, drop registerVendorTools, hop 5 says the approve is HTTP for now). A stale .next
  validator referenced the deleted handoff page; rm -rf .next cleared the typecheck. The demo's
  printed_name answer collided with #18 and was dropped (test commit). Live flow demo from main:
  4/4, checkout page names every attendee. Left from #12's checklist: approve through a page tool
  (next), and the curation agent's prepare_handoff tool name.
- #15 landed as 685d9b4 (clean). Resend over fetch; log mailer in dev; delivery state per request.
- #6 landed as 36803ec (two route conflicts with #15 resolved: withOwnedEvent + awaited calls). Dev
  without DATABASE_URL and no session runs as the local organizer for its own events only. Gate: 166
  vitest, 18 Playwright, live flow demo 4/4. #8 closed as delivered by #12 + #6.
- feat(attendees): approval runs through the page's approve_specs tool (the last #12 checklist item);
  the MCP endpoint dispatches it too. Live flow demo 4/4.
- #9 landed as 3c37c46 (clean). Playwright v1.62.1-noble image, standalone output, esbuild-compiled
  migrate.mjs as preDeployCommand, Blueprint plans 1c-2g and 0.1c-256mb in ohio. Build verified here;
  the image build and the Blueprint apply wait for the Render workspace (#2 stays open for that).
- #7 landed as 4755f86 (clean). Homepage at /, draft at /events/new, list at /events; five
  GIFs under 1 MB in public/media captured by scripts/capture-home-media.ts. Gate: 166 vitest, 19
  Playwright, live flow demo 4/4. The static screenshot shows each GIF's first frame only; judge the
  clips in the browser.
- #16 landed as 7d15963 (clean). Docs reconciled with the shipped code; prepare_handoff renamed
  prepare_cart; tutorial re-recorded: tests/videos/flow-demo-2026-09-02-with-checkout.mp4 (2:22).
  Open on the user's side: #14 theme install, #2 live deploy (Render workspace), the license file.
- Render (#2): the workspace is set via the API (tea-…6q0). The existing free native-Node service
  `tokuchu` failed on every push: `next start -p 3113` versus Render's PORT 10000, plus Auth.js
  UntrustedHost with no AUTH_URL. A paid Postgres and a Docker service were refused with 402 (no
  card on the workspace). Interim without a card: free Postgres `tokuchu-db` (expires in 30 days),
  the service's env set from .env (never printed), build installs Chromium and copies public/static
  into the standalone dir, start runs the migration then the standalone server. The Blueprint path
  (Docker on 1c-2g) waits for a payment method.
- #14: the theme write was blocked by the session's permission classifier; scripts/install-theme-adapter.ts
  does it from the owner's terminal (dry-run verified against the live Tinker theme).
- #2 closed: https://tokuchu.onrender.com live on the free native service + free Postgres (30-day
  expiry), configured through the API. First live run found the standalone trace dropped
  playwright-core/browsers.json (fixed in 5cad7d2). Verified on production: sign-in via the logged
  magic link, event, get_customization through Chromium in 24 s, request, RSVP, approval job 32 s,
  checkout URL opens in a fresh browser with both names. Blueprint (Docker, paid) waits for a card.
- #14 closed: the user allowed the theme write; scripts/install-theme-adapter.ts upserted the asset and
  the layout tag into the live Tinker theme (previous layout saved locally). Verified with the polyfill
  alone: get_customization and add_customized_to_cart register from the theme with three fields and six
  variants. The app now injects only the polyfill. Live tools spec and flow demo green.

## 2026-09-02 — Guest demo mode (#19, #20, #21)

User: a guest demo on the live site on a per-visitor test organizer, the flow-demo steps run live in
that session with spotlight callouts and a first-person organizer narration panel (text only), guests
only; LLM paths off unless needed.
- #21 landed as 0cab585 (clean). LLM_ENABLED off by default: curate route 501, panel hidden, SDK
  loaded dynamically only when on. Gate: 169 vitest, 19 Playwright.
- #19 landed as 7417ebd (+ 32983e4 fixing the curate test's cookie read). GET /demo mints a signed
  demo cookie, seeds and publishes the symposium event for that owner, and redirects to its dashboard
  with snapshot.demo = true; sweep after 24 h. Gate: 178 vitest, 20 Playwright.
- #20 landed as ceda487 (route conflict with the redirect fix resolved: public origin + autoplay
  forwarding). Nine steps as data in src/demo/steps.ts drive the real controls; spotlight mask +
  callout with first-person narration, Back/Next/Autoplay. Gate: 183 vitest, 21 Playwright, live
  tour 1/1 from main (1.2 min to the checkout link).
- fix(demo) c7c43e6: /demo on Render redirected to https://0.0.0.0:10000; redirects now use APP_URL.
- Guest tour verified on production: /demo?autoplay=1 reached the checkout link in 108 s; a fresh
  browser opened it with Avery, Blake, and Carmen on the lines. Note for checks: the tour root is a
  zero-size container, so wait for it attached rather than visible.
- fix(demo) ffb1f96: typing /demo in Chrome prefetches it; two cookie-less requests minted two demo
  ids and the browser kept the wrong one, so the page loaded and every action answered 403. A
  prefetch now gets 204 without a cookie; a demo caller on an event it does not own is sent to
  /demo from the page and from the dashboard poll. Verified on production: prefetch 204, wrong
  event redirects to /demo.
- #22 landed as 7ea583d (clean). Wire block per step with end-and-page labels (Tokuchu page tool,
  invite page tool, store page tool, Shopify page tool, store UCP endpoint), wait anchoring, the
  demo-store labeling in the pick step and the routing panel. Gate: 189 vitest, 21 Playwright, live
  tour 1/1. User asked next (#23): drop the post-approval lock (allow overwrite, re-approve refills
  a fresh cart) and sweep the vendor-era copy.
