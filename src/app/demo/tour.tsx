"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../events/[id]/dashboard";
import { DEMO_ATTENDEES, DEMO_STORE } from "../../demo/seed";
import { STEPS, startIndex, type TourAction, type TourStep, type TourTarget } from "../../demo/steps";

/** The pause between a step settling and autoplay moving on, so the result reads before the next callout. */
const READ_MS = 3000;
const POLL_MS = 250;
const KEY_MS = 18;
const STORE_MS = 240_000;
const PAGE_MS = 15_000;
const CALLOUT_WIDTH = 420;

type Phase = "entering" | "ready" | "running" | "failed";
type Rect = { top: number; left: number; width: number; height: number };
type Viewport = { width: number; height: number };
type Note = (text: string | null) => void;

function selector({ testId, shop }: TourTarget): string {
  return `[data-testid="${testId}"]${shop ? `[data-shop="${shop}"]` : ""}`;
}

function find<T extends HTMLElement>(target: TourTarget): T | null {
  return document.querySelector<T>(selector(target));
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

async function search(setNote: Note): Promise<void> {
  const input = await waitFor(() => find<HTMLInputElement>({ testId: "sentence" }), "Opening the sentence box", PAGE_MS, setNote);
  await typeInto(input, DEMO_STORE.search);
  click({ testId: "search" });
  await waitFor(orFailure({ testId: "results" }, "gx-error"), "Searching the catalog and checking delivery", STORE_MS, setNote);
  const store: TourTarget = { testId: "result", shop: DEMO_STORE.shop_domain };
  // The store's crewneck ranks near the top; each page of five shows more until it appears.
  for (let i = 0; i < 6 && !find(store); i++) find<HTMLElement>({ testId: "show-more" })?.click();
  await waitFor(() => find(store), "Looking for the store's crewneck in the results", PAGE_MS, setNote);
}

async function pick(setNote: Note): Promise<void> {
  click({ testId: "result", shop: DEMO_STORE.shop_domain });
  await waitFor(() => find({ testId: "recipients" }), "Opening the recipients", PAGE_MS, setNote);
  click({ testId: "next" });
  await waitFor(() => find({ testId: "confirm" }), "Opening the variants", PAGE_MS, setNote);
  click({ testId: "confirm" });
  await waitFor(orFailure({ testId: "gift" }, "gx-error"), "Asking the store for its customization fields", STORE_MS, setNote);
}

async function request(setNote: Note): Promise<void> {
  click({ testId: "request-fields" });
  await waitFor(() => {
    if (find({ testId: "request-error" })) throw new Error(find({ testId: "request-error" })!.textContent || "The request failed");
    return document.querySelector('[data-testid="requested-field"][data-source="definition"]');
  }, "Sending the request", PAGE_MS, setNote);
}

/** Loads the three replies through the RSVP route with the store's size choice and the star map answers. */
async function answer(eventId: string, setNote: Note): Promise<void> {
  const snap = (await (await fetch(`/api/events/${eventId}`, { cache: "no-store" })).json()) as Snapshot;
  const def = (key: string) => snap.definitions.find((d) => d.key === key);
  const size = def("variant_size");
  const location = def("star_map_location");
  const time = def("star_map_time");
  if (!size || !location || !time) throw new Error("The requested questions are not on the event yet");
  const sizeValue = (label: string) => size.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? size.constraints.options?.[0]?.value;
  const guests = DEMO_ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [size.id]: sizeValue(a.size), [location.id]: a.location, [time.id]: a.time } }));
  const res = await fetch(`/api/events/${eventId}/rsvp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guests }) });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "The replies did not load");
  changed();
  await waitFor(() => document.querySelectorAll('[data-testid="attendee-row"]').length >= DEMO_ATTENDEES.length && document.querySelector('[data-state="missing"]') === null, "Filling the records grid", PAGE_MS, setNote);
}

async function approve(setNote: Note): Promise<void> {
  click({ testId: "approve-send" });
  await waitFor(orFailure({ testId: "specs-approved" }, "approve-error"), "Locking the answers", 30_000, setNote);
}

async function cart(setNote: Note): Promise<void> {
  await waitFor(orFailure({ testId: "review-cart" }, "cart-failed"), "The store is filling the cart", STORE_MS, setNote);
}

/** Each action drives the page's own controls and settles when the page shows the result. */
const ACTIONS: Record<TourAction, (eventId: string, setNote: Note) => Promise<void>> = {
  search: (_, note) => search(note),
  pick: (_, note) => pick(note),
  request: (_, note) => request(note),
  answer,
  approve: (_, note) => approve(note),
  cart: (_, note) => cart(note)
};

function currentTab(): string | null {
  return document.querySelector('.tabs button[aria-current="page"]')?.getAttribute("data-testid")?.replace("tab-", "") ?? null;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  return a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

/**
 * The guided tour over the demo event: it walks the steps in order, spotlights each step's target,
 * narrates the organizer's situation, and drives the real controls when a step has an action. Mounted
 * only when the snapshot marks the event as a demo organizer's.
 */
export function Tour({ snap }: { snap: Snapshot }) {
  const [index, setIndex] = useState(() => startIndex(snap));
  const [phase, setPhase] = useState<Phase>("entering");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [height, setHeight] = useState(0);
  // The viewport is read after mount so the server and the first client render agree on the callout's place.
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef<string | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const isComplete = useCallback((s: TourStep) => !s.action || completed.has(s.id) || Boolean(s.done?.(snapRef.current)), [completed]);

  useEffect(() => {
    setAutoplay(new URLSearchParams(window.location.search).get("autoplay") === "1");
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // Entering a step: switch to its tab, wait for its target, and bring the target into view.
  useEffect(() => {
    let stop = false;
    setPhase("entering");
    setError(null);
    setRect(null);
    (async () => {
      if (currentTab() !== step.tab) find<HTMLElement>({ testId: `tab-${step.tab}` })?.click();
      const timeout = step.target.testId === "review-cart" ? STORE_MS : PAGE_MS;
      try {
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

  // The spotlight follows the target: the rect is read on a short interval so a re-render or a scroll moves it.
  useEffect(() => {
    let previous: Rect | null = null;
    const read = () => {
      const el = find<HTMLElement>(step.target);
      const next = el ? (({ top, left, width, height }) => ({ top, left, width, height }))(el.getBoundingClientRect()) : null;
      if (!sameRect(previous, next)) {
        previous = next;
        setRect(next);
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
  }, [step]);

  /** Runs the step's action once, then moves on; a step already shown finished moves on at once. */
  const advance = useCallback(async () => {
    if (busyRef.current === step.id) return;
    if (!isComplete(step)) {
      busyRef.current = step.id;
      setPhase("running");
      setError(null);
      try {
        await ACTIONS[step.action!](snap.event.id, setNote);
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
  }, [step, index, last, isComplete, snap.event.id]);

  // Autoplay: once the callout is in place the step reads for a moment and then runs.
  useEffect(() => {
    if (!autoplay || phase !== "ready" || last) return;
    const timer = setTimeout(() => void advance(), READ_MS);
    return () => clearTimeout(timer);
  }, [autoplay, phase, last, advance]);

  useEffect(() => {
    const el = calloutRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const checkout = last ? (snap.gifts[0]?.checkout_url ?? null) : null;
  const box = viewport ? calloutPosition(rect, height, viewport) : { top: 0, left: 0, visibility: "hidden" as const };

  return (
    <div className="tour" data-testid="tour" data-step={step.id} data-phase={phase}>
      {rect && <div className="tour-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} aria-hidden="true" />}
      <div className="tour-callout" ref={calloutRef} style={box} role="dialog" aria-labelledby="tour-title" data-testid="tour-step" data-step={index + 1}>
        <div className="tour-count">Step {index + 1} of {STEPS.length}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p data-testid="tour-narration">{step.narration}</p>
        {note && <p className="tour-note" data-testid="tour-note">{note}</p>}
        {error && <p className="error" role="alert" data-testid="tour-error">{error}</p>}
        <div className="tour-acts">
          <button type="button" className="btn ghost small" onClick={() => setIndex(index - 1)} disabled={index === 0 || phase === "running"} data-testid="tour-back">Back</button>
          {checkout ? (
            <a className="btn primary small" href={checkout} target="_blank" rel="noreferrer" data-testid="tour-checkout">Open the checkout</a>
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

/** The callout sits below its target when there is room and above it otherwise; with no target it centers. */
function calloutPosition(rect: Rect | null, height: number, viewport: Viewport): { top: number; left: number } {
  const margin = 16;
  const maxLeft = viewport.width - CALLOUT_WIDTH - margin;
  if (!rect) return { top: Math.max(margin, (viewport.height - height) / 2), left: Math.max(margin, (viewport.width - CALLOUT_WIDTH) / 2) };
  const below = rect.top + rect.height + 14;
  const top = below + height + margin <= viewport.height ? below : Math.max(margin, rect.top - 14 - height);
  return { top, left: Math.min(Math.max(margin, rect.left), maxLeft) };
}
