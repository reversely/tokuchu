/**
 * The tour's steps as data, in the order tests/flow-demo.spec.ts runs them. The tour reads a step's
 * tab and target to place the callout, its narration to tell the organizer's situation, its action
 * name to drive the page's own controls, its `done` predicate to skip a step the event already shows
 * finished, and its `wire` to list the WebMCP calls the step makes with the data they carry.
 */
import { DEMO_ATTENDEES, DEMO_STORE } from "./seed";

export type TourTab = "overview" | "experience" | "attendees";
export type TourAction = "search" | "pick" | "request" | "answer" | "approve" | "cart";
export type TourPhase = "entering" | "ready" | "running" | "failed";

/** A `data-testid` on the page; `shop` narrows a result card to the one from that store. */
export type TourTarget = { testId: string; shop?: string };

/** What the tour reads from the dashboard's snapshot to decide which steps the event already shows finished. */
export type TourState = {
  guests: { status: string }[];
  requests: { complete: boolean }[];
  gifts: { locked_at: string | null; checkout_url?: string | null }[];
};

/** The gift as the wire reads it: the store, the product, the fields and variants the store answered, and the cart's lines. */
export type WireGift = {
  shop_domain: string;
  product_title: string;
  locked_at: string | null;
  personalization?: { fields: { label: string; kind: string; max_length?: number; constraints?: { max_length?: number } }[] } | null;
  variants: { title: string }[];
  checkout_url?: string | null;
  cart_fill?: { status: string } | null;
  cart_lines?: { guest_id: string }[] | null;
};

/** The snapshot fields the wire reads; the dashboard's snapshot satisfies it. */
export type WireSnapshot = TourState & {
  event: { id: string; invite_code?: string | null };
  guests: { status: string; display_name: string }[];
  definitions: { scope: string; label: string }[];
  gifts: WireGift[];
};

/** What the tour reads off the page for the wire: the search funnel rows, the ranked cards, the requested labels, and the records rows. */
export type WirePage = { funnelRows: string[]; rankedCount: number; askedLabels: string[]; attendeeRows: number };

/** One post in the gift's updates thread, as `GET /api/events/{id}/gifts/{giftId}/updates` returns it. */
export type WireUpdate = { text: string; reference?: string | null };

export type WireContext = { snap: WireSnapshot; gift: WireGift | null; page: WirePage; updates: WireUpdate[]; phase: TourPhase };

/** One line of the wire; `working` marks a call in flight and `done` a result that arrived. */
export type WireLine = { text: string; state?: "working" | "done" };

export type TourStep = {
  id: string;
  tab: TourTab;
  target: TourTarget;
  /** Where the callout pins while the action runs, so the page behind it relates to the wait. */
  waitTarget?: string;
  title: string;
  narration: string;
  action?: TourAction;
  done?: (state: TourState) => boolean;
  wire?: (ctx: WireContext) => WireLine[];
  /** The step's wire reads the gift's updates thread, so the tour polls it while the step runs. */
  readsThread?: boolean;
};

const hasGift = (s: TourState) => s.gifts.length > 0;
const hasRequests = (s: TourState) => s.requests.length > 0;
const hasAnswers = (s: TourState) => s.guests.filter((g) => g.status === "going").length >= 3 && hasRequests(s) && s.requests.every((r) => r.complete);
const isApproved = (s: TourState) => Boolean(s.gifts[0]?.locked_at);
const hasCheckout = (s: TourState) => Boolean(s.gifts[0]?.checkout_url);

const CATALOG_ENDPOINT = "catalog.shopify.com/api/ucp/mcp";
const storeEndpoint = (shop: string) => `${shop}/api/ucp/mcp`;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const working = (busy: boolean): WireLine["state"] => (busy ? "working" : undefined);
const line = (text: string, state?: WireLine["state"]): WireLine => ({ text, state });
const result = (text: string) => line(`← ${text}`, "done");
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The field as the store's schema states it: the label, the kind, and the length limit when one applies. */
function fieldLine(f: NonNullable<WireGift["personalization"]>["fields"][number]): string {
  const max = f.constraints?.max_length ?? f.max_length;
  return `• ${f.label}  ${f.kind}${max ? `  max ${max}` : ""}`;
}

function publishedWire({ snap }: WireContext): WireLine[] {
  return [line("Tokuchu page tool  request_from_attendees follow_up approve_specs get_requirements  registered on this page"), line(`invite page tool  submit_rsvp  registered on /i/${snap.event.invite_code ?? ""}`)];
}

function searchWire({ page, phase }: WireContext): WireLine[] {
  const calls = [line(`Global Catalog  search_catalog  ${CATALOG_ENDPOINT}`), line(`store UCP endpoint  search_catalog  ${storeEndpoint(DEMO_STORE.shop_domain)}`), line(`→ "${DEMO_STORE.search}"`, working(phase === "running" && page.rankedCount === 0))];
  if (page.rankedCount === 0) return calls;
  return [...calls, ...page.funnelRows.map((r) => line(`→ ${r}`)), result(plural(page.rankedCount, "ranked product"))];
}

function pickWire({ gift, phase }: WireContext): WireLine[] {
  const lines = [
    line(`demo store  ${DEMO_STORE.shop_domain}  trading as ${DEMO_STORE.shop_name}`),
    line(`store UCP endpoint  ${storeEndpoint(DEMO_STORE.shop_domain)}`),
    line("Shopify page tool  search_catalog get_product get_cart update_cart and the rest"),
    line("store page tool  get_customization add_customized_to_cart"),
    line(`store page tool  get_customization  ${gift?.product_title ?? "the crewneck"}`, working(phase === "running" && !gift))
  ];
  if (!gift) return lines;
  return [...lines, result(`${plural(gift.personalization?.fields.length ?? 0, "field")}  ${plural(gift.variants.length, "variant")}`)];
}

function requirementsWire({ gift }: WireContext): WireLine[] {
  if (!gift) return [];
  const fields = gift.personalization?.fields ?? [];
  return [line(`store page tool  get_customization  ${gift.product_title}`), ...fields.map((f) => line(fieldLine(f))), result(`${plural(gift.variants.length, "variant")}  ${gift.variants.map((v) => v.title).join(" ")}`)];
}

function requestWire({ snap, page, phase }: WireContext): WireLine[] {
  const lines = [line(`Tokuchu page tool  request_from_attendees  ${page.askedLabels.join("  ")}`, working(phase === "running")), line("email  each attendee's own link to the form")];
  const questions = snap.definitions.filter((d) => d.scope === "guest").length;
  if (phase === "running" || questions === 0) return lines;
  return [...lines, result(`${plural(questions, "question")} on the form`), ...(snap.requests.length ? [result(plural(snap.requests.length, "request row"))] : [])];
}

function answersWire({ snap, page, phase }: WireContext): WireLine[] {
  const lines = [line("invite page tool  submit_rsvp  registered on each attendee's invite page"), line(`invite page tool  submit_rsvp  POST /api/events/${snap.event.id}/rsvp`, working(phase === "running" && page.attendeeRows < DEMO_ATTENDEES.length)), ...DEMO_ATTENDEES.map((a) => line(`→ ${a.display_name}`))];
  if (page.attendeeRows === 0) return lines;
  return [...lines, result(`${plural(page.attendeeRows, "row")} in the records grid`)];
}

/** The approve step and the cart step share one wire: the two hops in order, the job's posts as they arrive, and the checkout host. */
function cartWire({ snap, gift, updates, phase }: WireContext): WireLine[] {
  if (!gift) return [];
  const count = gift.cart_lines?.length || snap.guests.filter((g) => g.status === "going").length;
  const locked = Boolean(gift.locked_at);
  // The cart job runs on the server once the lock is on, so its line works until the checkout link or a failure arrives.
  const filling = locked && !gift.checkout_url && gift.cart_fill?.status !== "failed";
  const lines = [
    line(`Tokuchu page tool  approve_specs  ${gift.product_title} for ${plural(count, "attendee")}`, working(phase === "running" && !locked)),
    line(`store page tool  add_customized_to_cart  ${plural(count, "item")}`, working(filling)),
    ...updates.map((u) => result(u.text))
  ];
  if (!gift.checkout_url) return lines;
  return [...lines, result(`checkout_url  ${hostOf(gift.checkout_url)}`)];
}

function checkoutWire({ gift }: WireContext): WireLine[] {
  if (!gift?.checkout_url) return [];
  return [line(`store page tool  add_customized_to_cart  ${plural(gift.cart_lines?.length ?? 0, "cart line")}`), result(`checkout_url  ${hostOf(gift.checkout_url)}`)];
}

export const STEPS: TourStep[] = [
  {
    id: "published",
    tab: "overview",
    target: { testId: "invite-link" },
    title: "The event is published",
    narration: "I run the Eastern Canada Astronomy Symposium every year and order one crewneck per attendee. The event is published, and attendees reply through this invite link.",
    wire: publishedWire
  },
  {
    id: "search",
    tab: "experience",
    target: { testId: "sentence" },
    waitTarget: "search-results",
    title: "Describe the item",
    narration: "I need one crewneck per attendee with a star map of the venue and each person's name on it. I describe it in a sentence and the app searches Shopify stores over WebMCP.",
    action: "search",
    done: hasGift,
    wire: searchWire
  },
  {
    id: "pick",
    tab: "experience",
    target: { testId: "result", shop: DEMO_STORE.shop_domain },
    waitTarget: "gifts",
    title: "Pick the store's crewneck",
    narration: `The results come from Shopify's catalog and from each store's own endpoint. This crewneck comes from the demo store set up for this project, ${DEMO_STORE.shop_domain}, trading as ${DEMO_STORE.shop_name}. I pick it and confirm the recipients, and the app opens the store's page and calls its get_customization tool through WebMCP.`,
    action: "pick",
    done: hasGift,
    wire: pickWire
  },
  {
    id: "requirements",
    tab: "attendees",
    target: { testId: "requested-info" },
    title: "The store's requirements",
    narration: "The store answered get_customization with the fields this crewneck needs, and the app shows each one with where its value comes from. The name comes from the RSVP. The size and the star map details have to come from each attendee.",
    wire: requirementsWire
  },
  {
    id: "request",
    tab: "attendees",
    target: { testId: "request-fields" },
    waitTarget: "requested-info",
    title: "Request the missing values",
    narration: "I ask for the missing values through request_from_attendees, a tool this page registers over WebMCP. Each attendee gets an email with a link to a form that carries the store's limits and choices.",
    action: "request",
    done: hasRequests,
    wire: requestWire
  },
  {
    id: "answers",
    tab: "attendees",
    target: { testId: "attendees" },
    waitTarget: "attendees",
    title: "Attendees answer",
    narration: "Replies arrive as attendees fill in the form, and each invite page registers submit_rsvp over WebMCP so an agent can answer through it too. In this demo the three replies load through that tool's RSVP route, and each one fills a row in the records grid.",
    action: "answer",
    done: hasAnswers,
    wire: answersWire
  },
  {
    id: "approve",
    tab: "attendees",
    target: { testId: "approve-send" },
    waitTarget: "approve-block",
    title: "Approve",
    narration: "Every row is complete, so I approve through approve_specs, a tool this page registers over WebMCP. Approval locks the answers, and the app opens the store's page and calls its add_customized_to_cart with one item per attendee.",
    action: "approve",
    done: isApproved,
    wire: cartWire,
    readsThread: true
  },
  {
    id: "cart",
    tab: "attendees",
    target: { testId: "approve-block" },
    waitTarget: "approve-block",
    title: "The cart fills at the store",
    narration: "The app is on the store's page calling add_customized_to_cart over WebMCP, and the cart job posts each step into the gift's thread. When the store answers, the checkout link appears here.",
    action: "cart",
    done: hasCheckout,
    wire: cartWire,
    readsThread: true
  },
  {
    id: "checkout",
    tab: "attendees",
    target: { testId: "review-cart" },
    title: "Open the checkout",
    narration: "The cart is at the store with one line per attendee, built by add_customized_to_cart over WebMCP. I open the checkout and pay. I typed nothing into the store by hand.",
    wire: checkoutWire
  }
];

/**
 * The step a returning visitor resumes at: the first step whose work the event does not show
 * finished, backed up to the informational step that introduces it.
 */
export function startIndex(state: TourState, steps: TourStep[] = STEPS): number {
  const firstOpen = steps.findIndex((s) => s.done && !s.done(state));
  let index = firstOpen === -1 ? steps.length - 1 : firstOpen;
  while (index > 0 && !steps[index - 1].done) index -= 1;
  return index;
}
