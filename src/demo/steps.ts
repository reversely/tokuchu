/**
 * The tour's steps as data, in the order tests/flow-demo.spec.ts runs them. The tour reads a step's
 * tab and target to place the callout, its narration to tell the organizer's situation, its action
 * name to drive the page's own controls, its `done` predicate to skip a step the event already shows
 * finished, and its `wire` to list the WebMCP calls the step makes with the data they carry. A step
 * that concerns one of the three gifts names it, and the tour selects that gift on the Attendees tab.
 */
import { DEMO_ATTENDEES, DEMO_GIFT_ORDER, DEMO_GIFTS, DEMO_STORE, type DemoGiftKey } from "./seed";

export type TourTab = "overview" | "experience" | "attendees";
export type TourAction = "search" | "pick" | "pick_mug" | "pick_food" | "request" | "answer" | "approve" | "cart";
export type TourPhase = "entering" | "ready" | "running" | "failed";

/** A `data-testid` on the page; `shop` narrows a result card to the one from that store, and `gift` selects that gift on the Attendees tab first. */
export type TourTarget = { testId: string; shop?: string; gift?: DemoGiftKey };

/** The gift as the tour and the wire read it: the store, the product, the fields and variants the store answered, and the cart's state. */
export type TourGift = {
  id: string;
  shop_domain: string;
  product_title: string;
  requested_at?: string | null;
  approved_at?: string | null;
  personalization?: { fields: { label: string; kind: string; max_length?: number; constraints?: { max_length?: number } }[] } | null;
  variants: { title: string }[];
  checkout_url?: string | null;
  cart_fill?: { status: string } | null;
  cart_lines?: { guest_id: string }[] | null;
};

/** What the tour reads from the dashboard's snapshot to decide which steps the event already shows finished. */
export type TourState = {
  guests: { status: string }[];
  requests: { gift_id: string; complete: boolean }[];
  gifts: TourGift[];
};

/** The snapshot fields the wire reads; the dashboard's snapshot satisfies it. */
export type WireSnapshot = TourState & {
  event: { id: string; invite_code?: string | null };
  guests: { status: string; display_name: string }[];
  definitions: { scope: string; label: string }[];
};

/** What the tour reads off the page for the wire: the search funnel rows, the ranked cards, the requested labels, and the records rows. */
export type WirePage = { funnelRows: string[]; rankedCount: number; askedLabels: string[]; attendeeRows: number };

/** One post in a gift's progress log, as `GET /api/events/{id}/gifts/{giftId}/updates` returns it. */
export type WireUpdate = { text: string; reference?: string | null };

/** The three gifts by key, `null` where the event does not hold one yet; `updates` holds each gift's progress log by gift id. */
export type WireContext = { snap: WireSnapshot; gifts: Record<DemoGiftKey, TourGift | null>; page: WirePage; updates: Record<string, WireUpdate[]>; phase: TourPhase };

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
  /** The step's wire reads the gifts' progress logs, so the tour polls them while the step runs. */
  readsThread?: boolean;
};

const bareHost = (shop: string) => shop.replace(/^https?:\/\//, "");

/** The gift a key names among the event's gifts: the demo store's by a word in the title, the food gift as the one from any other store. */
export function demoGift<T extends Pick<TourGift, "shop_domain" | "product_title">>(gifts: T[], key: DemoGiftKey): T | null {
  const spec = DEMO_GIFTS[key];
  if (spec.shop_domain) return gifts.find((g) => bareHost(g.shop_domain) === spec.shop_domain && (spec.title?.test(g.product_title) ?? true)) ?? null;
  return gifts.find((g) => bareHost(g.shop_domain) !== DEMO_STORE.shop_domain) ?? null;
}

/** The three gifts by key. */
export function demoGifts<T extends Pick<TourGift, "shop_domain" | "product_title">>(gifts: T[]): Record<DemoGiftKey, T | null> {
  return { crewneck: demoGift(gifts, "crewneck"), mug: demoGift(gifts, "mug"), food: demoGift(gifts, "food") };
}

const hasGift = (key: DemoGiftKey) => (s: TourState) => demoGift(s.gifts, key) !== null;
/** The request went out once the gift records it; the rows come later, since a reply that already carries the answers needs none. */
const hasRequests = (key: DemoGiftKey) => (s: TourState) => Boolean(demoGift(s.gifts, key)?.requested_at);
const hasAnswers = (s: TourState) => s.guests.filter((g) => g.status === "going").length >= DEMO_ATTENDEES.length && s.requests.every((r) => r.complete);
const allApproved = (s: TourState) => DEMO_GIFT_ORDER.every((key) => Boolean(demoGift(s.gifts, key)?.approved_at));
const allCheckedOut = (s: TourState) => DEMO_GIFT_ORDER.every((key) => Boolean(demoGift(s.gifts, key)?.checkout_url));

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
function fieldLine(f: NonNullable<TourGift["personalization"]>["fields"][number]): string {
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

/** The store's tools and the `get_customization` call for one of its products. */
function storePickWire(key: DemoGiftKey, { gifts, phase }: WireContext): WireLine[] {
  const gift = gifts[key];
  const lines = [
    line(`demo store  ${DEMO_STORE.shop_domain}  trading as ${DEMO_STORE.shop_name}`),
    line(`store UCP endpoint  ${storeEndpoint(DEMO_STORE.shop_domain)}`),
    line("Shopify page tool  search_catalog get_product get_cart update_cart and the rest"),
    line("store page tool  get_customization add_customized_to_cart"),
    line(`store page tool  get_customization  ${gift?.product_title ?? DEMO_GIFTS[key].label}`, working(phase === "running" && !gift))
  ];
  if (!gift) return lines;
  return [...lines, ...(gift.personalization?.fields ?? []).map((f) => line(fieldLine(f))), result(`${plural(gift.personalization?.fields.length ?? 0, "field")}  ${plural(gift.variants.length, "variant")}`)];
}

const pickWire = (ctx: WireContext) => storePickWire("crewneck", ctx);
const pickMugWire = (ctx: WireContext) => storePickWire("mug", ctx);

/** The food search runs the card's rows in Shopify's food and beverage category, and the pick reads the product through the catalog with no customization tool to call. */
function pickFoodWire({ gifts, page, phase }: WireContext): WireLine[] {
  const gift = gifts.food;
  const calls = [line(`Global Catalog  search_catalog  ${CATALOG_ENDPOINT}  category fb`, working(phase === "running" && !gift && page.rankedCount === 0))];
  if (page.rankedCount > 0 && !gift) calls.push(...page.funnelRows.map((r) => line(`→ ${r}`)), result(plural(page.rankedCount, "ranked product")));
  if (!gift) return calls;
  return [...calls, line(`Global Catalog  get_product  ${gift.product_title}`), result(`${plural(gift.variants.length, "variant")}  no customization tool  ${bareHost(gift.shop_domain)}`), line(`store UCP endpoint  create_cart create_checkout  ${storeEndpoint(bareHost(gift.shop_domain))}`)];
}

function requirementsWire(key: DemoGiftKey) {
  return ({ gifts }: WireContext): WireLine[] => {
    const gift = gifts[key];
    if (!gift) return [];
    const fields = gift.personalization?.fields ?? [];
    return [line(`store page tool  get_customization  ${gift.product_title}`), ...fields.map((f) => line(fieldLine(f))), result(`${plural(gift.variants.length, "variant")}  ${gift.variants.map((v) => v.title).join(" ")}`)];
  };
}

function requestWire(key: DemoGiftKey) {
  return ({ snap, gifts, page, phase }: WireContext): WireLine[] => {
    const gift = gifts[key];
    const lines = [line(`Tokuchu page tool  request_from_attendees  ${page.askedLabels.join("  ")}`, working(phase === "running")), line("email  each attendee's own link to the form")];
    const questions = snap.definitions.filter((d) => d.scope === "guest").length;
    if (phase === "running" || questions === 0) return lines;
    const rows = gift ? snap.requests.filter((r) => r.gift_id === gift.id).length : 0;
    return [...lines, result(`${plural(questions, "question")} on the form`), ...(rows ? [result(plural(rows, "request row"))] : [])];
  };
}

function plainWire({ gifts }: WireContext): WireLine[] {
  const gift = gifts.food;
  if (!gift) return [];
  return [line(`Global Catalog  get_product  ${gift.product_title}`), result("no customization fields"), line("Tokuchu  quantities follow the going count until the checkout")];
}

function answersWire({ snap, page, phase }: WireContext): WireLine[] {
  const lines = [line("invite page tool  submit_rsvp  registered on each attendee's invite page"), line(`invite page tool  submit_rsvp  POST /api/events/${snap.event.id}/rsvp`, working(phase === "running" && page.attendeeRows < DEMO_ATTENDEES.length)), ...DEMO_ATTENDEES.map((a) => line(`→ ${a.display_name}`))];
  if (page.attendeeRows === 0) return lines;
  return [...lines, result(`${plural(page.attendeeRows, "row")} in the records grid`)];
}

/** One gift's hops on approval: the approve call, the store's cart call, the job's posts as they arrive, and the checkout host. */
function giftCartWire(key: DemoGiftKey, { snap, gifts, updates, phase }: WireContext): WireLine[] {
  const gift = gifts[key];
  if (!gift) return [];
  const going = snap.guests.filter((g) => g.status === "going").length;
  const count = gift.cart_lines?.length || going;
  const approved = Boolean(gift.approved_at);
  // The cart job runs on the server once the approval is recorded, so its line works until the checkout link or a failure arrives.
  const filling = approved && !gift.checkout_url && gift.cart_fill?.status !== "failed";
  const store = bareHost(gift.shop_domain);
  const call = gift.personalization?.fields.length ? line(`store page tool  add_customized_to_cart  ${plural(count, "item")}`, working(filling)) : line(`store UCP endpoint  create_cart create_checkout  ${plural(going, "line")}  ${store}`, working(filling));
  const lines = [line(`Tokuchu page tool  approve_specs  ${gift.product_title} for ${plural(going, "attendee")}`, working(phase === "running" && !approved)), call, ...(updates[gift.id] ?? []).map((u) => result(u.text))];
  if (!gift.checkout_url) return lines;
  return [...lines, result(`checkout_url  ${hostOf(gift.checkout_url)}`)];
}

/** The approve step and the cart step share one wire: every gift's hops in order. */
function cartWire(ctx: WireContext): WireLine[] {
  return DEMO_GIFT_ORDER.flatMap((key) => giftCartWire(key, ctx));
}

function checkoutWire({ gifts }: WireContext): WireLine[] {
  return DEMO_GIFT_ORDER.flatMap((key) => {
    const gift = gifts[key];
    if (!gift?.checkout_url) return [];
    const call = gift.personalization?.fields.length ? `store page tool  add_customized_to_cart  ${plural(gift.cart_lines?.length ?? 0, "cart line")}` : `store UCP endpoint  create_checkout  ${bareHost(gift.shop_domain)}`;
    return [line(call), result(`checkout_url  ${hostOf(gift.checkout_url)}`)];
  });
}

export const STEPS: TourStep[] = [
  {
    id: "published",
    tab: "overview",
    target: { testId: "invite-link" },
    title: "The event is published",
    narration: "I run the Eastern Canada Astronomy Symposium every year and send every attendee home with three things: a crewneck, a mug, and a box of treats. The event is published, and attendees reply through this invite link.",
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
    done: hasGift("crewneck"),
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
    done: hasGift("crewneck"),
    wire: pickWire
  },
  {
    id: "pick_mug",
    tab: "experience",
    target: { testId: "add-gift" },
    waitTarget: "gifts",
    title: "Pick the store's mug as the favour",
    narration: "The same results list the store's other customizable products. I go back to them and pick the ceramic mug as the favour. The store's get_customization answers with one field: a photo each attendee supplies.",
    action: "pick_mug",
    done: hasGift("mug"),
    wire: pickMugWire
  },
  {
    id: "pick_food",
    tab: "experience",
    target: { testId: "add-gift" },
    waitTarget: "search-results",
    title: "Add something to eat",
    narration: "The third gift is food. I choose the food and drink card, which searches Shopify's catalog in its food and beverage category and checks that each product ships to the venue by the date. I pick the first result whose delivery check passed. This product has no customization tool, so its order goes through the store's own cart.",
    action: "pick_food",
    done: hasGift("food"),
    wire: pickFoodWire
  },
  {
    id: "requirements",
    tab: "attendees",
    target: { testId: "requested-info", gift: "crewneck" },
    title: "The crewneck's requirements",
    narration: "The Attendees tab shows one gift at a time. The store answered get_customization with the fields this crewneck needs, and the app shows each one with where its value comes from. The name comes from the RSVP. The size and the star map details have to come from each attendee.",
    wire: requirementsWire("crewneck")
  },
  {
    id: "request",
    tab: "attendees",
    target: { testId: "request-fields", gift: "crewneck" },
    waitTarget: "requested-info",
    title: "Request the crewneck's values",
    narration: "I ask for the missing values through request_from_attendees, a tool this page registers over WebMCP. Each attendee gets an email with a link to a form that carries the store's limits and choices.",
    action: "request",
    done: hasRequests("crewneck"),
    wire: requestWire("crewneck")
  },
  {
    id: "request_mug",
    tab: "attendees",
    target: { testId: "request-fields", gift: "mug" },
    waitTarget: "requested-info",
    title: "Request the photo for the mug",
    narration: "The mug needs one thing the RSVP does not hold: a photo. The same request tool turns the store's image field into a file question on the form, and each attendee pastes the address of a picture.",
    action: "request",
    done: hasRequests("mug"),
    wire: requestWire("mug")
  },
  {
    id: "plain",
    tab: "attendees",
    target: { testId: "requested-info", gift: "food" },
    title: "Nothing to ask for the food",
    narration: "The food gift has no fields. There is nothing to ask attendees; the store's cart takes one unit per person going, and the count follows the replies until the checkout.",
    wire: plainWire
  },
  {
    id: "answers",
    tab: "attendees",
    target: { testId: "attendees", gift: "crewneck" },
    waitTarget: "attendees",
    title: "Attendees answer",
    narration: "Replies arrive as attendees fill in the form, and each invite page registers submit_rsvp over WebMCP so an agent can answer through it too. In this demo the three replies load through that tool's RSVP route with the size, the star map details, and the photo, and each one fills a row in the records grid.",
    action: "answer",
    done: hasAnswers,
    wire: answersWire
  },
  {
    id: "approve",
    tab: "attendees",
    target: { testId: "approve-send", gift: "crewneck" },
    waitTarget: "approve-block",
    title: "Approve each gift",
    narration: "Every row is complete, so I approve each gift through approve_specs, a tool this page registers over WebMCP. For the crewneck and the mug the app opens the store's page and calls its add_customized_to_cart with one item per attendee. For the food it creates the store's own cart and checkout through the store's UCP endpoint.",
    action: "approve",
    done: allApproved,
    wire: cartWire,
    readsThread: true
  },
  {
    id: "cart",
    tab: "attendees",
    target: { testId: "approve-block", gift: "crewneck" },
    waitTarget: "approve-block",
    title: "The carts fill at the stores",
    narration: "Each cart job posts its steps into the gift's progress log. When a store answers, that gift's checkout link appears under its approval. Three gifts from two stores give three links.",
    action: "cart",
    done: allCheckedOut,
    wire: cartWire,
    readsThread: true
  },
  {
    id: "checkout",
    tab: "attendees",
    target: { testId: "review-cart", gift: "crewneck" },
    title: "Open the checkouts",
    narration: "The crewneck's cart and the mug's cart are at the store with one line per attendee, built by add_customized_to_cart over WebMCP. The food checkout holds one line with the going count. I open each link and pay. I typed nothing into any store by hand.",
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
