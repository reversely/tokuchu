/**
 * The agent playbook as a script (#57): follows docs/agent-playbook.md step by step with Playwright
 * in place of a model, against a static-mode server (`TOKUCHU_STATIC=1`) on AGENT_BASE (default
 * http://localhost:3114) and the live demo store. Prints each tool call with a summary of its
 * result and records the run into tests/videos, one file per page.
 *
 *   TOKUCHU_STATIC=1 npm run dev -- -p 3114     # in one shell
 *   npm run agent-playbook                      # in another
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.AGENT_BASE ?? "http://localhost:3114").replace(/\/+$/, "");
const SHOP_DOMAIN = "springbuilt.myshopify.com";
const PRODUCT_ID = "10242071789817";
const PRODUCT_URL = `https://${SHOP_DOMAIN}/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt`;
const OUT = "tests/videos";
const POLYFILL = readFileSync("src/webmcp/polyfill.js", "utf8");
const ATTENDEES = JSON.parse(readFileSync("tests/fixtures/demo-attendees.json", "utf8")).attendees;
const EVENT = { title: "Agent playbook run", host: "The organizer", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" }, delivery: { destination: "venue", address: null, needed_by: "2029-12-20" } };
const email = (a) => `${a.display_name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

let step = 0;
const say = (line) => console.log(line);
const short = (value) => {
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

/** One JSON call to Tokuchu's API, for the setup an organizer would have done by hand: the event and the guest list. */
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${json.error ?? JSON.stringify(json)}`);
  return json;
}

/** Waits for a page to list every named tool on document.modelContext, then lets a dev server's second mount settle. */
async function waitForTools(page, names) {
  await page.waitForFunction((expected) => {
    const ctx = document.modelContext;
    return ctx ? ctx.getTools().then((tools) => expected.every((n) => tools.some((t) => t.name === n))) : false;
  }, names, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  await page.waitForFunction((expected) => document.modelContext.getTools().then((tools) => expected.every((n) => tools.some((t) => t.name === n))), names, { timeout: 60_000 });
}

/** Runs one WebMCP tool on a page the way the playbook's one-liner does, prints the call, and returns the parsed payload. */
async function call(page, where, name, args, summarize = (p) => short(p)) {
  step += 1;
  say(`\n[${step}] ${where} → ${name} ${short(args)}`);
  const { text, isError } = await page.evaluate(async ({ name, args }) => {
    const ctx = document.modelContext;
    // A dev server mounts a React page twice, so a tool can vanish for a moment between the first registration and the second; wait it out.
    let tool;
    for (let attempt = 0; attempt < 40 && !tool; attempt++) {
      tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) await new Promise((r) => setTimeout(r, 250));
    }
    if (!tool) throw new Error(`Tool ${name} is not registered on this page`);
    const result = await ctx.executeTool(tool, args);
    return { text: result.content[0]?.text ?? "null", isError: result.isError === true };
  }, { name, args });
  const payload = JSON.parse(text);
  if (isError) {
    say(`    ← error: ${payload.error ?? text}`);
    throw new Error(`${name} failed: ${payload.error ?? text}`);
  }
  say(`    ← ${summarize(payload)}`);
  return payload;
}

const listTools = (page) => page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name).sort());

async function main() {
  say(`Tokuchu at ${BASE}; the store at ${PRODUCT_URL}`);
  mkdirSync(OUT, { recursive: true });

  // The organizer's setup: the event, published, with the guest list replying going.
  const { id: eventId } = await api("POST", "/api/events", EVENT);
  await api("POST", `/api/events/${eventId}/publish`);
  const snap = await api("GET", `/api/events/${eventId}`);
  if (!snap.static) throw new Error(`The server at ${BASE} is not in static mode; start it with TOKUCHU_STATIC=1.`);
  const { guest_ids: guestIds } = await api("POST", `/api/events/${eventId}/rsvp`, { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going" })) });
  say(`Event ${eventId} published with ${guestIds.length} attendees going; invite code ${snap.event.invite_code}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  // The polyfill runs before every page's scripts, so the store's theme and Tokuchu's pages both register their tools in this Chromium.
  await context.addInitScript({ content: POLYFILL });
  const tokuchu = await context.newPage();
  const store = await context.newPage();
  const videos = [];
  try {
    // Step 1: the event page and its tools.
    await tokuchu.goto(`${BASE}/events/${eventId}?webmcp=polyfill`, { waitUntil: "domcontentloaded" });
    await waitForTools(tokuchu, ["set_gift_plan", "set_gift_customization", "get_fulfillment_manifest"]);
    say(`\nTokuchu tools: ${(await listTools(tokuchu)).join(" ")}`);
    const task = await tokuchu.evaluate(() => document.querySelector('meta[name="tokuchu-agent-task"]')?.getAttribute("content") ?? "");
    say(`Agent task: ${task.slice(0, 140)}...`);
    const { guests } = await call(tokuchu, "Tokuchu", "list_guests", { filter: "status:eq:going" }, (p) => `${p.guests.length} going: ${p.guests.map((g) => g.display_name).join(", ")}`);

    // Step 2: the store's page and its customization contract.
    await store.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" });
    await waitForTools(store, ["get_customization", "add_customized_to_cart"]);
    say(`\nStore tools: ${(await listTools(store)).join(" ")}`);
    const customization = await call(store, "Store", "get_customization", { product_id: PRODUCT_ID }, (p) => `${p.title}: fields ${p.fields.map((f) => `${f.key} (${f.kind})`).join(", ")}; ${p.variants.length} variants`);

    // Steps 3 and 4: the gift on Tokuchu with the store's contract.
    const gift = await call(tokuchu, "Tokuchu", "set_gift_plan", { rules: [{ filter: [{ field: "status", op: "eq", value: "going" }], product_id: PRODUCT_ID }], shop_domain: SHOP_DOMAIN, product_title: customization.title, product_url: PRODUCT_URL }, (p) => `gift ${p.id} for ${p.product_title}`);
    await call(tokuchu, "Tokuchu", "set_gift_customization", { gift_id: gift.id, ...customization }, (p) => `${p.personalization.fields.length} fields and ${p.variants.length} variants on gift ${p.id}`);

    // Step 5: the requirements and what fills each.
    const before = await call(tokuchu, "Tokuchu", "get_requirements", { gift_id: gift.id }, (p) => p.requirements.map((r) => `${r.key} ← ${r.source}`).join(", "));
    await call(tokuchu, "Tokuchu", "request_from_attendees", { gift_id: gift.id }, (p) => `${p.requests.length} requests recorded; ${p.definitions.length} questions on the event`);
    const after = await call(tokuchu, "Tokuchu", "get_requirements", { gift_id: gift.id }, (p) => p.requirements.map((r) => `${r.key} ← ${r.source}`).join(", "));
    const rows = after.requirements.filter((r) => r.kind !== "variant").map((r) => r.mapping ?? { vendor_field_key: r.key, source: { type: "definition", definition_id: r.definition_id, subject_scope: "guest" } });
    await call(tokuchu, "Tokuchu", "set_personalization_mapping", { gift_id: gift.id, mappings: rows }, (p) => `${p.personalization_mappings.length} mappings on gift ${p.id}`);
    void before;

    // Step 6: only what list_missing names is asked.
    const { definitions } = await api("GET", `/api/events/${eventId}`);
    const asked = definitions.filter((d) => d.scope === "guest" && d.required_rule === "going");
    const missing = {};
    for (const def of asked) {
      const reply = await call(tokuchu, "Tokuchu", "list_missing", { definition_id: def.id, filter: "status:eq:going" }, (p) => `${p.guests.length} attendees lack ${p.definition.key}`);
      for (const g of reply.guests) (missing[g.id] ??= []).push(def);
    }

    // The attendees answer through their own invite page's submit_rsvp tool, one page per attendee.
    for (const [i, attendee] of ATTENDEES.entries()) {
      const guestId = guestIds[i];
      const invite = await context.newPage();
      await invite.goto(`${BASE}/i/${snap.event.invite_code}?guest=${guestId}&webmcp=polyfill`, { waitUntil: "domcontentloaded" });
      await waitForTools(invite, ["submit_rsvp"]);
      const answers = {};
      for (const def of missing[guestId] ?? []) {
        if (def.key === "variant_size") answers[def.key] = def.constraints.options.find((o) => o.label.toLowerCase() === attendee.size.toLowerCase())?.value;
        else if (def.key === "star_map_location") answers[def.key] = attendee.location;
        else if (def.key === "star_map_time") answers[def.key] = attendee.time;
        else answers[def.key] = attendee.display_name;
      }
      await call(invite, `Invite of ${attendee.display_name}`, "submit_rsvp", { display_name: attendee.display_name, status: "going", email: email(attendee), guest_id: guestId, ...answers }, (p) => `guest ${p.guest_id} ${p.status} with ${Object.keys(p.answers).length} answers`);
      videos.push([invite.video(), `${OUT}/agent-playbook-invite-${i + 1}-${stamp}.webm`]);
      await invite.close();
    }

    // Step 7: the manifest reads ready, then the approval.
    let manifest;
    for (let attempt = 0; attempt < 10; attempt++) {
      manifest = await call(tokuchu, "Tokuchu", "get_fulfillment_manifest", { gift_id: gift.id }, (p) => `revision ${p.revision}; ${p.attendees.map((a) => a.status).join(", ")}; ${p.cart_items.length} cart items`);
      if (manifest.attendees.every((a) => a.status === "ready")) break;
      await tokuchu.waitForTimeout(1000);
    }
    if (!manifest.attendees.every((a) => a.status === "ready")) throw new Error("The manifest never read ready for every attendee.");
    const approved = await call(tokuchu, "Tokuchu", "approve_specs", { gift_id: gift.id }, (p) => `approved at ${p.approved_at}; cart_fill ${p.cart_fill ?? "none"}`);
    const ready = await call(tokuchu, "Tokuchu", "get_fulfillment_manifest", { gift_id: gift.id }, (p) => `approved revision ${p.approved_revision}; ${p.cart_items.length} cart items`);

    // Step 8: the cart items go to the store's page.
    const cart = await call(store, "Store", "add_customized_to_cart", { items: ready.cart_items, idempotency_key: `${gift.id}:${approved.approved_at}` }, (p) => `${p.ready.length} ready, ${p.blocked.length} blocked; checkout ${p.checkout_url}`);

    // Step 9: the checkout link on the gift's log.
    await call(tokuchu, "Tokuchu", "post_update", { gift_id: gift.id, kind: "in_production", text: `The cart at ${SHOP_DOMAIN} is ready to review`, reference: cart.checkout_url }, (p) => `update ${p.id} with reference ${p.reference}`);

    // The store's side: a grant's signed link opens the store-facing page with its own tools.
    const grant = await api("POST", `/api/events/${eventId}/grants`, { procurement_id: gift.id, grantee_type: "agent", grantee_id: SHOP_DOMAIN, permissions: ["manifest:read", "requirements:read", "changes:read", "updates:read", "updates:write"], allowed_attribute_ids: asked.map((d) => d.id) });
    const storeSide = await context.newPage();
    await storeSide.goto(`${BASE}${grant.link}`, { waitUntil: "domcontentloaded" });
    await storeSide.goto(`${BASE}/store/${grant.id}?webmcp=polyfill`, { waitUntil: "domcontentloaded" });
    await waitForTools(storeSide, ["get_fulfillment_manifest", "post_procurement_update", "get_changes", "acknowledge_changes"]);
    say(`\nStore-side tools: ${(await listTools(storeSide)).join(" ")}`);
    const seen = await call(storeSide, "Store side", "get_fulfillment_manifest", { procurement_id: gift.id }, (p) => `revision ${p.revision} approved ${p.approved_revision}; ${p.attendees.length} attendees; values ${Object.keys(p.attendees[0]?.values ?? {}).join(", ")}`);
    await call(storeSide, "Store side", "post_procurement_update", { procurement_id: gift.id, type: "accepted", reference: `PO-${gift.id}` }, (p) => `status ${p.procurement_status} at revision ${p.current_revision}`);
    await call(storeSide, "Store side", "get_changes", { procurement_id: gift.id, after_revision: seen.approved_revision }, (p) => `${p.changes.length} changes after ${seen.approved_revision}: ${p.changes.map((c) => c.type).join(", ")}`);
    await call(storeSide, "Store side", "acknowledge_changes", { revision: seen.revision + 1 }, (p) => `seen up to revision ${p.acknowledged_revision} of ${p.current_revision}`);
    videos.push([storeSide.video(), `${OUT}/agent-playbook-store-side-${stamp}.webm`]);

    say(`\nDone. The checkout link: ${cart.checkout_url}`);
  } finally {
    videos.push([tokuchu.video(), `${OUT}/agent-playbook-${stamp}.webm`], [store.video(), `${OUT}/agent-playbook-store-${stamp}.webm`]);
    await context.close();
    for (const [video, path] of videos) {
      if (!video) continue;
      await video.saveAs(path);
      await video.delete();
      say(`video ${path}`);
    }
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
