"use client";
import { replyError } from "../../lib/reply-error";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Snapshot } from "../events/[id]/dashboard";
import { DEMO_ATTENDEES, DEMO_CORRECTION, DEMO_GIFT_ORDER, DEMO_GIFTS, DEMO_STORE, type DemoGiftKey } from "../../demo/seed";
import { Intro } from "./intro";
import { EMPTY_STORE, STEPS, demoGift, demoGifts, startIndex, type StoreChange, type StoreManifestRow, type StoreWire, type TourAction, type TourPhase, type TourStep, type TourTarget, type WireLine, type WirePage, type WireUpdate } from "../../demo/steps";
import { withDemoHeaders } from "../../demo/token";

/** The pause between a step settling and autoplay moving on, so the result reads before the next callout. */
const READ_MS = 3000;
const POLL_MS = 250;
/** How often the wire re-reads the gifts' updates threads while a step that lists them runs. */
const THREAD_MS = 3000;
const KEY_MS = 18;
const STORE_MS = 240_000;
const PAGE_MS = 15_000;
const CALLOUT_WIDTH = 580;
/** How many pages of five the tour reveals while looking for one result. */
const RESULT_PAGES = 12;

type Phase = TourPhase;
type Rect = { top: number; left: number; width: number; height: number };
type Viewport = { width: number; height: number };
type Note = (text: string | null) => void;
/** What an action reads: the event, the note setter, the step's gift, the latest snapshot, and what the store's side read so far. */
type ActionContext = { eventId: string; setNote: Note; gift?: DemoGiftKey; snap: () => Snapshot; store: () => StoreWire; setStore: (next: (prev: StoreWire) => StoreWire) => void };
/** How long the store's page in the frame may take to register its tools. */
const FRAME_MS = 30_000;

const EMPTY_PAGE: WirePage = { funnelRows: [], rankedCount: 0, askedLabels: [], attendeeRows: 0 };
const CHECKOUT_LABEL: Record<DemoGiftKey, string> = { crewneck: "Crewneck checkout", mug: "Mug checkout", food: "Food checkout" };

const text = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim();
const texts = (selector: string) => Array.from(document.querySelectorAll(selector)).map(text);

/** What the wire reads off the page, the same reads the recorded flow demo's overlay made; a funnel row's cells join with a gap. */
function readPage(): WirePage {
  return {
    funnelRows: Array.from(document.querySelectorAll('[data-testid="funnel"] .row')).map((row) => Array.from(row.children).map(text).join("  ")),
    rankedCount: document.querySelectorAll('[data-testid="result"]').length,
    askedLabels: texts('[data-testid="requested-field"]:not([data-source="guest"]):not([data-source="event"]):not([data-source="literal"]) strong'),
    attendeeRows: document.querySelectorAll('[data-testid="attendee-row"]').length
  };
}

function samePage(a: WirePage, b: WirePage): boolean {
  return a.rankedCount === b.rankedCount && a.attendeeRows === b.attendeeRows && a.funnelRows.join("\n") === b.funnelRows.join("\n") && a.askedLabels.join("\n") === b.askedLabels.join("\n");
}

/** The wire marks the call in flight; a running step with no marked line shows the indicator on its last line. */
function markWorking(lines: WireLine[], phase: Phase): WireLine[] {
  if (phase !== "running" || lines.length === 0 || lines.some((l) => l.state === "working")) return lines;
  return lines.map((l, i) => (i === lines.length - 1 ? { ...l, state: "working" } : l));
}

function selector({ testId, shop }: TourTarget): string {
  return `[data-testid="${testId}"]${shop ? `[data-shop="${shop}"]` : ""}`;
}

function find<T extends HTMLElement>(target: TourTarget): T | null {
  return document.querySelector<T>(selector(target));
}

/** The result card from `shop` whose title matches, among the cards shown so far. */
function findResult(shop: string, title: RegExp | null): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector({ testId: "result", shop }))).find((el) => title === null || title.test(text(el))) ?? null;
}

/** Polls `probe` until it returns a value; the note names the wait for the callout while it lasts. */
async function waitFor<T>(probe: () => T | null | undefined | false, note: string, timeoutMs: number, setNote: Note): Promise<T> {
  setNote(note);
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const found = probe();
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`${note} took longer than ${Math.round(timeoutMs / 1000)} seconds`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    setNote(null);
  }
}

function click(target: TourTarget): void {
  const el = find<HTMLElement>(target);
  if (!el) throw new Error(`No ${target.testId} on the page`);
  el.click();
}

/** Types into a React-controlled input through the native value setter so its onChange sees each character. */
async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (let i = 1; i <= text.length; i++) {
    set.call(input, text.slice(0, i));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, KEY_MS));
  }
}

/** A probe for `target` that fails at once when the page shows the error `failure` names instead. */
function orFailure(target: TourTarget, failure: string): () => Element | null {
  return () => {
    const shown = find({ testId: failure });
    if (shown) throw new Error(shown.textContent || "The step failed");
    return find(target);
  };
}

function changed(): void {
  window.dispatchEvent(new Event("event:changed"));
}

/** Selects one of the three gifts on the Attendees tab, when the event holds it and the tab shows a switcher. */
async function selectGift(key: DemoGiftKey, ctx: ActionContext): Promise<void> {
  const gift = demoGift(ctx.snap().gifts, key);
  if (!gift) throw new Error(`The event has no ${DEMO_GIFTS[key].label} yet`);
  const tab = document.querySelector<HTMLElement>(`[data-testid="gift-tab"][data-gift="${gift.id}"]`);
  if (!tab || tab.getAttribute("aria-current") === "true") return;
  tab.click();
  await waitFor(() => document.querySelector(`[data-testid="requested-info"][data-gift="${gift.id}"]`), `Opening ${DEMO_GIFTS[key].label}`, PAGE_MS, ctx.setNote);
}

/** Reveals pages of results until the probe finds a card. */
async function revealResult(probe: () => HTMLElement | null, note: string, setNote: Note): Promise<HTMLElement> {
  for (let i = 0; i < RESULT_PAGES && !probe(); i++) {
    const more = find<HTMLElement>({ testId: "show-more" });
    if (!more) break;
    more.click();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return waitFor(probe, note, PAGE_MS, setNote);
}

/** The pick flow from a result card: the recipients, the variants, and the confirm that saves the gift and reads the store's fields. */
async function pickCard(card: HTMLElement, expectedGifts: number, setNote: Note): Promise<void> {
  card.scrollIntoView({ block: "center" });
  card.click();
  await waitFor(() => find({ testId: "recipients" }), "Opening the recipients", PAGE_MS, setNote);
  click({ testId: "next" });
  await waitFor(() => find({ testId: "confirm" }), "Opening the variants", PAGE_MS, setNote);
  click({ testId: "confirm" });
  await waitFor(() => {
    if (find({ testId: "gx-error" })) throw new Error(find({ testId: "gx-error" })!.textContent || "The pick failed");
    return document.querySelectorAll('[data-testid="gift"]').length >= expectedGifts;
  }, "Asking the store for its customization fields", STORE_MS, setNote);
}

async function search({ setNote }: ActionContext): Promise<void> {
  const input = await waitFor(() => find<HTMLInputElement>({ testId: "sentence" }), "Opening the sentence box", PAGE_MS, setNote);
  await typeInto(input, DEMO_STORE.search);
  click({ testId: "search" });
  await waitFor(orFailure({ testId: "results" }, "gx-error"), "Searching the catalog and checking delivery", STORE_MS, setNote);
  await revealResult(() => findResult(DEMO_STORE.shop_domain, DEMO_GIFTS.crewneck.title), "Looking for the store's crewneck in the results", setNote);
}

async function pick({ setNote }: ActionContext): Promise<void> {
  const card = await revealResult(() => findResult(DEMO_STORE.shop_domain, DEMO_GIFTS.crewneck.title), "Looking for the store's crewneck in the results", setNote);
  await pickCard(card, 1, setNote);
}

/** Back to the last results from the gifts list, then the store's mug. */
async function pickMug({ setNote }: ActionContext): Promise<void> {
  click({ testId: "add-gift" });
  const back = await waitFor(() => find<HTMLElement>({ testId: "last-results" }), "Returning to the results", PAGE_MS, setNote);
  back.click();
  await waitFor(() => find({ testId: "results" }), "Opening the results", PAGE_MS, setNote);
  const card = await revealResult(() => findResult(DEMO_STORE.shop_domain, DEMO_GIFTS.mug.title), "Looking for the store's mug in the results", setNote);
  await pickCard(card, 2, setNote);
}

/** The food card's search, then the top result. */
async function pickFood({ setNote }: ActionContext): Promise<void> {
  click({ testId: "add-gift" });
  const card = await waitFor(() => find<HTMLElement>({ testId: `card-${DEMO_GIFTS.food.card}` }), "Opening the cards", PAGE_MS, setNote);
  card.click();
  await waitFor(orFailure({ testId: "results" }, "gx-error"), "Searching the food and beverage category and checking delivery", STORE_MS, setNote);
  // The first result whose delivery check passed: a card the store's checkout quoted for the venue.
  const first = await revealResult(() => document.querySelector<HTMLElement>('[data-testid="result"][data-delivery="quoted"]'), "Looking for the first result with a delivery quote", setNote);
  await pickCard(first, 3, setNote);
}

async function request(ctx: ActionContext): Promise<void> {
  if (ctx.gift) await selectGift(ctx.gift, ctx);
  click({ testId: "request-fields" });
  await waitFor(() => {
    if (find({ testId: "request-error" })) throw new Error(find({ testId: "request-error" })!.textContent || "The request failed");
    return document.querySelector('[data-testid="requested-field"][data-source="definition"]');
  }, "Sending the request", PAGE_MS, ctx.setNote);
}

type Definition = Snapshot["definitions"][number];

/** One attendee's answer to a question the requests created: the seeded value for the known keys, the first choice or the name otherwise. */
function answerFor(def: Definition, attendee: (typeof DEMO_ATTENDEES)[number]): unknown {
  const option = (label: string) => def.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? def.constraints.options?.[0]?.value;
  if (def.key === "variant_size") return option(attendee.size);
  if (def.key === "star_map_location") return attendee.location;
  if (def.key === "star_map_time") return attendee.time;
  if (def.key === "photo" || def.value_type === "file") return attendee.photo;
  if (def.value_type === "enum") return def.constraints.options?.[0]?.value;
  if (def.value_type === "multi_enum") return def.constraints.options?.[0] ? [def.constraints.options[0].value] : [];
  return attendee.display_name;
}

/** Loads the three replies through the RSVP route with an answer to every question the requests created. */
async function answer({ eventId, setNote }: ActionContext): Promise<void> {
  const fresh = (await (await fetch(`/api/events/${eventId}`, withDemoHeaders({ cache: "no-store" }))).json()) as Snapshot;
  const asked = fresh.definitions.filter((d) => d.scope === "guest" && d.required_rule === "going" && d.creator === "organizer");
  if (!asked.some((d) => d.key === "variant_size") || !asked.some((d) => d.key === "star_map_location")) throw new Error("The requested questions are not on the event yet");
  const guests = DEMO_ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: Object.fromEntries(asked.map((d) => [d.id, answerFor(d, a)])) }));
  const res = await fetch(`/api/events/${eventId}/rsvp`, withDemoHeaders({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guests }) }));
  if (!res.ok) throw new Error(await replyError(res));
  changed();
  // The legend under the grid names the missing state too, so only a cell counts.
  await waitFor(() => document.querySelectorAll('[data-testid="attendee-row"]').length >= DEMO_ATTENDEES.length && document.querySelector('[data-testid="attendees-grid"] [data-state="missing"]') === null, "Filling the records grid", PAGE_MS, setNote);
}

/** Approves every gift in order, selecting each on the tab; a gift already approved is left as it is. */
async function approve(ctx: ActionContext): Promise<void> {
  for (const key of DEMO_GIFT_ORDER) {
    await selectGift(key, ctx);
    if (find({ testId: "specs-approved" })) continue;
    click({ testId: "approve-send" });
    await waitFor(orFailure({ testId: "specs-approved" }, "approve-error"), `Recording the approval of ${DEMO_GIFTS[key].label}`, 30_000, ctx.setNote);
    changed();
  }
  if (ctx.gift) await selectGift(ctx.gift, ctx);
}

/** Waits for every gift's checkout link, selecting each gift in turn so the page shows the cart that is filling. */
async function cart(ctx: ActionContext): Promise<void> {
  for (const key of DEMO_GIFT_ORDER) {
    await selectGift(key, ctx);
    await waitFor(orFailure({ testId: "review-cart" }, "cart-failed"), `The store is filling the cart for ${DEMO_GIFTS[key].label}`, STORE_MS, ctx.setNote);
  }
  if (ctx.gift) await selectGift(ctx.gift, ctx);
}

/** Creates the store's access from the Share block with the access it offers by default. */
async function share(ctx: ActionContext): Promise<void> {
  await selectGift("crewneck", ctx);
  click({ testId: "share-create" });
  await waitFor(() => {
    if (find({ testId: "share-error" })) throw new Error(find({ testId: "share-error" })!.textContent || "The access was not created");
    return document.querySelector('[data-testid="share-grant"][data-status="active"]');
  }, "Creating the store access", PAGE_MS, ctx.setNote);
  changed();
}

/* ---- The store's side, through the store page's own WebMCP tools in the inline frame ---- */

type FrameContext = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
type StoreManifest = NonNullable<StoreWire["manifest"]>;

const storeFrame = () => find<HTMLIFrameElement>({ testId: "tour-store-frame" });

/** The store page's model context once the page in the frame registered its tools; the frame is same-origin, so its document is readable. */
async function storeContext(setNote: Note): Promise<FrameContext> {
  return waitFor(() => {
    const doc = storeFrame()?.contentDocument as (Document & { modelContext?: FrameContext }) | null | undefined;
    if (!doc?.querySelector('[data-testid="webmcp-status"][data-status="ready"]')) return null;
    return doc.modelContext ?? null;
  }, "Opening the store's page", FRAME_MS, setNote);
}

/** Runs one of the store page's tools the way an agent would; an error result throws with the store's words. */
async function storeCall<T>(store: FrameContext, name: string, args: Record<string, unknown>): Promise<T> {
  const tool = (await store.getTools()).find((t) => t.name === name);
  if (!tool) throw new Error(`The store's page has no ${name} tool`);
  const result = await store.executeTool(tool, args);
  const text = result.content[0]?.text ?? "";
  if (result.isError) throw new Error((JSON.parse(text) as { error?: string }).error ?? `${name} failed`);
  return JSON.parse(text) as T;
}

/** The store page shows the state its tools changed after a reload; the reload keeps the polyfill's query. */
function reloadStoreFrame(): void {
  storeFrame()?.contentWindow?.location.reload();
}

const crewneckId = (ctx: ActionContext) => {
  const gift = demoGift(ctx.snap().gifts, "crewneck");
  if (!gift) throw new Error("The event has no crewneck yet");
  return gift.id;
};

/** Reads the manifest through get_fulfillment_manifest and keeps it for the wire. */
async function readManifest(ctx: ActionContext, store: FrameContext): Promise<StoreManifest> {
  const read = await storeCall<{ revision: number; approved_revision: number | null; attendees: StoreManifestRow[] }>(store, "get_fulfillment_manifest", { procurement_id: crewneckId(ctx) });
  const manifest = { revision: read.revision, approved_revision: read.approved_revision, attendees: read.attendees.map((a) => ({ attendee_ref: a.attendee_ref, status: a.status, values: a.values })) };
  ctx.setStore((prev) => ({ ...prev, manifest }));
  return manifest;
}

/** The store's agent lists the page's tools and reads the manifest. */
async function readStore(ctx: ActionContext): Promise<void> {
  const store = await storeContext(ctx.setNote);
  const tools = (await store.getTools()).map((t) => t.name);
  ctx.setStore((prev) => ({ ...prev, tools }));
  await readManifest(ctx, store);
}

/** The store's agent questions the bare place name through post_procurement_update; the grid then shows the exception. */
async function postException(ctx: ActionContext): Promise<void> {
  const store = await storeContext(ctx.setNote);
  const manifest = ctx.store().manifest ?? (await readManifest(ctx, store));
  const attendee = manifest.attendees.find((a) => a.values[DEMO_CORRECTION.requirement] === DEMO_CORRECTION.given);
  if (!attendee) throw new Error(`No attendee gave "${DEMO_CORRECTION.given}" for the star map location`);
  ctx.setNote("Posting the store's question");
  const posted = await storeCall<{ current_revision: number }>(store, "post_procurement_update", { procurement_id: crewneckId(ctx), type: "needs_information", attendee_ref: attendee.attendee_ref, requirement_id: DEMO_CORRECTION.requirement, message: DEMO_CORRECTION.message });
  ctx.setStore((prev) => ({ ...prev, posted: { revision: posted.current_revision } }));
  changed();
  reloadStoreFrame();
  await waitFor(() => document.querySelector(`[data-testid="exception"][data-attendee="${attendee.attendee_ref}"]`), "Waiting for the exception on the grid", PAGE_MS, ctx.setNote);
}

/** The attendee's corrected answer through the invite route, then the changes the store's agent reads after the approved revision. */
async function correct(ctx: ActionContext): Promise<void> {
  const snap = ctx.snap();
  const guest = snap.guests.find((g) => g.display_name === DEMO_CORRECTION.attendee);
  const def = snap.definitions.find((d) => d.scope === "guest" && (d.vendor_field?.key ?? d.key) === DEMO_CORRECTION.requirement);
  if (!guest || !def) throw new Error("The attendee or the star map location question is not on the event");
  ctx.setNote("Saving the attendee's corrected answer");
  const res = await fetch(`/api/events/${ctx.eventId}/rsvp/${guest.id}`, withDemoHeaders({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: { [def.id]: DEMO_CORRECTION.corrected } }) }));
  if (!res.ok) throw new Error(await replyError(res));
  changed();
  await waitFor(() => document.querySelector(`[data-testid="exception"][data-attendee="${guest.id}"][data-status="resolved"]`), "Waiting for the exception to resolve", PAGE_MS, ctx.setNote);
  const store = await storeContext(ctx.setNote);
  const after = demoGift(ctx.snap().gifts, "crewneck")?.approval?.approved_revision ?? 0;
  const read = await storeCall<{ changes: StoreChange[] }>(store, "get_changes", { procurement_id: crewneckId(ctx), after_revision: after });
  ctx.setStore((prev) => ({ ...prev, changes: read.changes.map((c) => ({ revision: c.revision, type: c.type, summary: c.summary })) }));
  reloadStoreFrame();
}

/** Approves the crewneck again and waits for the refilled cart's link. */
async function reapprove(ctx: ActionContext): Promise<void> {
  await selectGift("crewneck", ctx);
  click({ testId: "re-approve" });
  await waitFor(orFailure({ testId: "approval-revision" }, "approve-error"), "Recording the new approval", 30_000, ctx.setNote);
  changed();
  await waitFor(orFailure({ testId: "review-cart" }, "cart-failed"), "The store is filling the cart again", STORE_MS, ctx.setNote);
}

/** Each action drives the page's own controls and settles when the page shows the result. */
const ACTIONS: Record<TourAction, (ctx: ActionContext) => Promise<void>> = { search, pick, pick_mug: pickMug, pick_food: pickFood, request, answer, approve, cart, share, read_store: readStore, post_exception: postException, correct, reapprove };

function currentTab(): string | null {
  return document.querySelector('.tabs button[aria-current="page"]')?.getAttribute("data-testid")?.replace("tab-", "") ?? null;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  return a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

/**
 * The guided tour over the demo event: it walks the steps in order, spotlights each step's target,
 * narrates the organizer's situation, and drives the real controls when a step has an action. Mounted
 * only when the snapshot marks the event as the seeded demo.
 */
export function Tour({ snap }: { snap: Snapshot }) {
  const [index, setIndex] = useState(() => startIndex(snap));
  const introKey = `tokuchu_intro:${snap.event.id}`;
  const [intro, setIntro] = useState(() => startIndex(snap) === 0);
  const [phase, setPhase] = useState<Phase>("entering");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [page, setPage] = useState<WirePage>(EMPTY_PAGE);
  const [updates, setUpdates] = useState<Record<string, WireUpdate[]>>({});
  const [store, setStore] = useState<StoreWire>(EMPTY_STORE);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [height, setHeight] = useState(0);
  // The viewport is read after mount so the server and the first client render agree on the callout's place.
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef<string | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const storeRef = useRef(store);
  storeRef.current = store;

  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const isComplete = useCallback((s: TourStep) => !s.action || completed.has(s.id) || Boolean(s.done?.(snapRef.current)), [completed]);
  const context = useCallback((): ActionContext => ({ eventId: snap.event.id, setNote, gift: step.target.gift, snap: () => snapRef.current, store: () => storeRef.current, setStore }), [snap.event.id, step]);

  /** The store's page lands on `/store/{grant}` from the signed link; the tour then adds the polyfill's query so the page registers its tools in this browser. */
  const onFrameLoad = useCallback((e: SyntheticEvent<HTMLIFrameElement>) => {
    const win = e.currentTarget.contentWindow;
    if (!win) return;
    try {
      const url = new URL(win.location.href);
      if (url.pathname.startsWith("/store/") && url.searchParams.get("webmcp") !== "polyfill") {
        url.searchParams.set("webmcp", "polyfill");
        win.location.replace(url.toString());
      }
    } catch {
      /* a cross-origin frame has no readable location; the page then registers nothing */
    }
  }, []);

  useEffect(() => {
    setAutoplay(new URLSearchParams(window.location.search).get("autoplay") === "1");
    try {
      if (window.sessionStorage.getItem(introKey)) setIntro(false);
    } catch {
      /* storage can be unavailable; the story shows again */
    }
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // Entering a step: switch to its tab, select its gift, wait for its target, and bring the target into view.
  useEffect(() => {
    let stop = false;
    setPhase("entering");
    setError(null);
    setRect(null);
    (async () => {
      if (currentTab() !== step.tab) find<HTMLElement>({ testId: `tab-${step.tab}` })?.click();
      const timeout = step.target.testId === "review-cart" ? STORE_MS : PAGE_MS;
      try {
        if (step.target.gift) {
          await waitFor(() => (stop ? null : find({ testId: "requested-info" })), "Opening the page", PAGE_MS, setNote);
          await selectGift(step.target.gift, context());
        }
        const el = await waitFor(() => (stop ? null : find<HTMLElement>(step.target)), "Opening the page", timeout, setNote);
        el.scrollIntoView({ block: "center" });
        if (!stop) setPhase("ready");
      } catch {
        if (!stop) setPhase("ready");
      }
    })();
    return () => {
      stop = true;
    };
  }, [step]);

  // The spotlight follows the target, or the wait region while the action runs and that region is on the page. The
  // rect and the page reads the wire lists come from one short interval, so a re-render or a scroll moves both.
  useEffect(() => {
    let previous: Rect | null = null;
    let previousPage = EMPTY_PAGE;
    let anchored: HTMLElement | null = null;
    const read = () => {
      const waiting = phase === "running" && step.waitTarget ? find<HTMLElement>({ testId: step.waitTarget }) : null;
      const el = waiting ?? find<HTMLElement>(step.target);
      if (waiting && waiting !== anchored) waiting.scrollIntoView({ block: "center" });
      anchored = waiting;
      const next = el ? (({ top, left, width, height }) => ({ top, left, width, height }))(el.getBoundingClientRect()) : null;
      if (!sameRect(previous, next)) {
        previous = next;
        setRect(next);
      }
      const nextPage = readPage();
      if (!samePage(previousPage, nextPage)) {
        previousPage = nextPage;
        setPage(nextPage);
      }
    };
    read();
    const timer = setInterval(read, 200);
    window.addEventListener("resize", read);
    window.addEventListener("scroll", read, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", read);
      window.removeEventListener("scroll", read, true);
    };
  }, [step, phase]);

  // The gifts' updates threads feed the wire while a step that lists them runs; each cart job posts its steps there.
  const giftIds = snap.gifts.map((g) => g.id).join(",");
  useEffect(() => {
    if (!step.readsThread || phase !== "running" || !giftIds) return;
    let stop = false;
    const read = async () => {
      const next: Record<string, WireUpdate[]> = {};
      for (const id of giftIds.split(",")) {
        try {
          const res = await fetch(`/api/events/${snap.event.id}/gifts/${id}/updates`, withDemoHeaders({ cache: "no-store" }));
          if (res.ok) next[id] = ((await res.json()) as { updates: WireUpdate[] }).updates.map(({ text, reference }) => ({ text, reference }));
        } catch {
          // The next tick reads again.
        }
      }
      if (!stop) setUpdates(next);
    };
    void read();
    const timer = setInterval(() => void read(), THREAD_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [step.readsThread, phase, giftIds, snap.event.id]);

  /** Runs the step's action once, then moves on; a step already shown finished moves on at once. */
  const advance = useCallback(async () => {
    if (busyRef.current === step.id) return;
    if (!isComplete(step)) {
      busyRef.current = step.id;
      setPhase("running");
      setError(null);
      try {
        await ACTIONS[step.action!](context());
        setCompleted((prev) => new Set(prev).add(step.id));
        changed();
        await new Promise((r) => setTimeout(r, READ_MS));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("failed");
        busyRef.current = null;
        return;
      }
      busyRef.current = null;
    }
    if (!last) setIndex(index + 1);
    else setPhase("ready");
  }, [step, index, last, isComplete, context]);

  // Autoplay: once the callout is in place the step reads for a moment and then runs.
  useEffect(() => {
    if (!autoplay || intro || phase !== "ready" || last) return;
    const timer = setTimeout(() => void advance(), READ_MS);
    return () => clearTimeout(timer);
  }, [autoplay, intro, phase, last, advance]);

  useEffect(() => {
    const el = calloutRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const gifts = demoGifts(snap.gifts);
  const checkouts = last ? DEMO_GIFT_ORDER.flatMap((key) => (gifts[key]?.checkout_url ? [{ key, url: gifts[key]!.checkout_url! }] : [])) : [];
  // The frame opens the crewneck's active grant through its signed link; it stays mounted across the store's steps so the page loads once.
  const grantLink = step.frame ? (snap.grants.find((g) => g.procurement_id === gifts.crewneck?.id && g.status === "active")?.link ?? null) : null;
  const box = viewport ? calloutPosition(rect, height, viewport, Boolean(grantLink)) : { top: 0, left: 0, visibility: "hidden" as const };
  const closeIntro = useCallback(() => {
    setIntro(false);
    try {
      window.sessionStorage.setItem(introKey, "1");
    } catch {
      /* storage can be unavailable */
    }
  }, [introKey]);

  const wire = markWorking(step.wire?.({ snap, gifts, page, updates, phase, store }) ?? [], phase);

  return (
    <div className="tour" data-testid="tour" data-step={step.id} data-phase={phase} data-intro={intro ? "open" : "done"}>
      {intro && <Intro autoplay={autoplay} onDone={closeIntro} />}
      {!intro && rect && <div className="tour-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} aria-hidden="true" />}
      {!intro && grantLink && (
        <div className="tour-stage" data-testid="tour-stage">
          <iframe data-testid="tour-store-frame" title="The store's page" src={grantLink} onLoad={onFrameLoad} />
        </div>
      )}
      <div className="tour-callout" ref={calloutRef} style={intro ? { ...box, visibility: "hidden" } : box} role="dialog" aria-labelledby="tour-title" data-testid="tour-step" data-step={index + 1}>
        <div className="tour-count">Step {index + 1} of {STEPS.length}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p data-testid="tour-narration">{step.narration}</p>
        {wire.length > 0 && (
          <ol className="tour-wire" data-testid="tour-wire" aria-label="The calls this step makes over UCP or WebMCP">
            {wire.map((l, i) => <li key={i} data-state={l.state}>{l.text}</li>)}
          </ol>
        )}
        {note && <p className="tour-note" data-testid="tour-note">{note}</p>}
        {error && <p className="error" role="alert" data-testid="tour-error">{error}</p>}
        <div className="tour-acts">
          <button type="button" className="btn ghost small" onClick={() => setIndex(index - 1)} disabled={index === 0 || phase === "running"} data-testid="tour-back">Back</button>
          {checkouts.length > 0 ? (
            checkouts.map(({ key, url }) => (
              <a key={key} className="btn primary small" href={url} target="_blank" rel="noreferrer" data-testid={key === "crewneck" ? "tour-checkout" : `tour-checkout-${key}`}>{CHECKOUT_LABEL[key]}</a>
            ))
          ) : (
            <button type="button" className="btn primary small" onClick={() => void advance()} disabled={phase === "running" || (last && !isComplete(step))} data-testid="tour-next">{phase === "running" ? "Working" : last ? "Done" : "Next"}</button>
          )}
          <label className="tour-auto">
            <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} data-testid="tour-autoplay" />
            Autoplay
          </label>
        </div>
      </div>
    </div>
  );
}

/** The callout sits below its target when there is room and above it otherwise; with no target it centers, and beside the store's frame it takes the left column. */
function calloutPosition(rect: Rect | null, height: number, viewport: Viewport, beside: boolean): { top: number; left: number } {
  const width = Math.min(CALLOUT_WIDTH, viewport.width - 2 * 16);
  const margin = 16;
  const maxLeft = viewport.width - width - margin;
  if (beside && viewport.width > 900) return { top: 76, left: margin };
  if (!rect) return { top: Math.max(margin, (viewport.height - height) / 2), left: Math.max(margin, (viewport.width - width) / 2) };
  const below = rect.top + rect.height + 14;
  const top = below + height + margin <= viewport.height ? below : Math.max(margin, rect.top - 14 - height);
  return { top, left: Math.min(Math.max(margin, rect.left), maxLeft) };
}
