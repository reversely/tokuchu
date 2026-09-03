/**
 * The gift search the search route and the curation agent share (#120): a card or a sentence
 * becomes searches, each shortlisted product gets its detail and a delivery probe, and Stage 1
 * and 2 rank the result (PRD Sections 8, 10, 11). Extracted from the search route so both access
 * paths run one code path.
 */
import { catalogClient, storefrontEndpoint, type CatalogClient } from "@webmcp/shopify-ucp";
import { CUSTOMSHOP_SOURCE, customshopCandidates } from "../agent/customshop";
import {
  DEFAULT_SOURCES,
  cardsConfig,
  emptyFunnel,
  personalizedRequest,
  priceFit,
  rank,
  searchCandidates,
  searchesForSentence,
  sourcesForSentence,
  withDelivery,
  withDetail,
  type Candidate,
  type CardSearch,
  type EventContext,
  type Funnel,
  type Scored,
  type Source
} from "../agent/search";
import { guestsFor } from "../domain/store";
import { deliveryTarget } from "../lib/delivery";
import { BadRequestError, requireEvent } from "./api";
import { withStorePage } from "./store-page";
import { summarize, traceClient, traced, tracedStorePage } from "./trace";

export type GiftSearchBody = { card?: string; sentence?: string; probe?: number };
export type GiftSearchReply = {
  searches: CardSearch[];
  sources: Source[];
  context: EventContext;
  funnel: Funnel;
  found: number;
  probed: number;
  ranked: Scored[];
  excluded: { product_id: string; title: string; shop_name: string; rule: string | null; reason: string | null }[];
  duration_ms: number;
};

/** The custom shop's products beside the catalog's; a shop that does not answer leaves a funnel row naming the error and no candidates. */
async function customshopRows(eventId: string, client: CatalogClient, ctx: EventContext, funnel: Funnel): Promise<Candidate[]> {
  try {
    return await customshopCandidates(ctx, { funnel, client, withPage: tracedStorePage(eventId, withStorePage), probe: probeFor(eventId, funnel) });
  } catch (e) {
    funnel.searches.push({ query: CUSTOMSHOP_SOURCE, returned: 0, total: null, error: (e as Error).message });
    return [];
  }
}

/** The endpoint a delivery probe posts its `create_checkout` to. */
const probeEndpoint = (shop: string) => storefrontEndpoint(shop.replace(/^https?:\/\//, ""));

/**
 * The delivery probe with a trace entry per call (#55). A probe that throws records the failure,
 * leaves a funnel row naming it, and returns the candidate with the error on its delivery, so the
 * other candidates' verdicts stand.
 */
function probeFor(eventId: string, funnel: Funnel): typeof withDelivery {
  return async (candidate, ctx, fetchImpl) => {
    const call = { side: "store" as const, transport: "ucp" as const, endpoint: probeEndpoint(candidate.shop_domain), tool: "create_checkout", args: { product_id: candidate.product_id, destination: ctx.venue.postal_code } };
    try {
      return await traced(eventId, call, () => withDelivery(candidate, ctx, fetchImpl), { ok: (c) => !c.delivery?.error, result: (c) => summarize(c.delivery) });
    } catch (e) {
      const error = (e as Error).message;
      funnel.searches.push({ query: `probe ${candidate.shop_domain}`, returned: 0, total: null, error });
      return { ...candidate, delivery: { window: null, text: null, confidence: "unknown", verdict: "unknown", error } };
    }
  };
}

/**
 * A card or a sentence becomes searches, each shortlisted product gets its detail and a delivery
 * probe, and Stage 1 and 2 rank the result. A card or a sentence that names sweatshirts also lists
 * the custom shop's products; `probe` caps how many candidates get a checkout probe.
 */
export async function giftSearch(eventId: string, body: GiftSearchBody): Promise<GiftSearchReply> {
  const event = requireEvent(eventId);
  const config = cardsConfig();
  const card = body.card ? config.cards.find((c) => c.key === body.card) : undefined;
  if (body.card && !card) throw new BadRequestError(`No card ${body.card}; the cards are ${config.cards.map((c) => c.key).join(", ")}.`);
  const searches = card ? card.searches : body.sentence?.trim() ? searchesForSentence(body.sentence, config) : null;
  if (!searches) throw new BadRequestError("Send a card key or a sentence.");
  const sources = card ? (card.sources ?? DEFAULT_SOURCES) : sourcesForSentence(body.sentence ?? "", config);
  const going = guestsFor(event.id).filter((g) => g.status === "going").length;
  const target = deliveryTarget(event);
  if (!target.needed_by) throw new BadRequestError("Set where the gifts are delivered and by when before searching.");
  const ctx: EventContext = { event_date: target.needed_by, venue: target.address, budget_cents: event.cost_per_person_cents, quantity: going, today: new Date().toISOString().slice(0, 10), personalized: card ? !!card.personalized : personalizedRequest(body.sentence ?? "") };
  const started = Date.now();
  const client = traceClient(event.id, catalogClient());
  const funnel = emptyFunnel();
  const found = await searchCandidates(client, searches, ctx, { limit: 50, pages: 2, sleepMs: 1500, funnel });
  const custom = sources.includes(CUSTOMSHOP_SOURCE) ? await customshopRows(event.id, client, ctx, funnel) : [];
  const probe = probeFor(event.id, funnel);
  // The candidates that use the budget best and offer the most variants get the detail and a
  // delivery probe, a few shops at a time; the probe cap keeps a broad search inside a minute.
  const cap = Math.max(1, Math.min(body.probe ?? 30, 60));
  const preScore = (c: (typeof found)[number]) => priceFit(c.price_cents, ctx.budget_cents) * 2 + Math.min(c.variants.length, 6) / 6;
  const shortlist = [...found].filter((c) => ctx.budget_cents === null || c.price_cents === null || c.price_cents <= ctx.budget_cents).sort((a, b) => preScore(b) - preScore(a)).slice(0, cap);
  const probed: typeof shortlist = [];
  for (let i = 0; i < shortlist.length; i += 6) probed.push(...(await Promise.all(shortlist.slice(i, i + 6).map(async (c) => probe(await withDetail(client, c), ctx, fetch)))));
  funnel.probed = probed.length;
  const probedIds = new Set(probed.map((c) => c.product_id));
  const all = [...probed, ...found.filter((c) => !probedIds.has(c.product_id)), ...custom];
  const { ranked, excluded } = rank(all, ctx, config, funnel);
  // The custom shop's eligible products stay in view past the page cap: they are the ones whose customization tools the app can call.
  const page = [...ranked.slice(0, 15), ...ranked.slice(15).filter((c) => c.searches.includes(CUSTOMSHOP_SOURCE))];
  return {
    searches,
    sources,
    context: ctx,
    funnel,
    found: all.length,
    probed: probed.length,
    ranked: page,
    excluded: excluded.map((e) => ({ product_id: e.product_id, title: e.title, shop_name: e.shop_name, rule: e.verdict.rule, reason: e.verdict.reason })),
    duration_ms: Date.now() - started
  };
}
