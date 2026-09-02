/**
 * A configured Shopify shop as a search source. The Global Catalog does not index the shop, so
 * `customshopCandidates` lists its products through the shop's own UCP endpoint; the shared
 * client already sends the profile meta and the `catalog` argument that endpoint requires, so
 * `withEndpoint` is the whole reach. The shop's name and currency come from its `/meta.json`, and
 * each product's customization fields come from the shop's own `get_customization` tool on a
 * headless store page, read once per process, so the coverage term sees the name field. Each
 * candidate gets the shared checkout probe for a real delivery verdict.
 */
import { catalogClient, storefrontEndpoint, type CatalogClient, type CatalogProduct } from "@webmcp/shopify-ucp";
import { withDelivery, type Candidate, type EventContext, type Funnel, type PersonalizationField, type Variant } from "./search";

export const CUSTOMSHOP_SOURCE = "customshop";

export type StoreMeta = { name: string; currency: string };
/** Reads the customization fields of several products in one store session; a product the store has no customization for maps to null. */
export type FieldsReader = (pageUrl: string, productIds: string[]) => Promise<Map<string, PersonalizationField[] | null>>;

/** The shop's base URL from CUSTOMILY_SHOP_URL, or null when no shop is configured. */
export function customshopUrl(): string | null {
  const url = process.env.CUSTOMILY_SHOP_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

/** The host a gift's `shop_domain` carries when its product is the configured shop's. */
export function customshopHost(): string | null {
  const url = customshopUrl();
  return url ? new URL(url).host : null;
}

const metaCache = new Map<string, StoreMeta>();

/** The shop's name and currency from its `/meta.json`, cached for the process; a shop that does not answer keeps its host as the name. */
export async function storeMeta(shopUrl: string, fetchImpl: typeof fetch = fetch): Promise<StoreMeta> {
  const cached = metaCache.get(shopUrl);
  if (cached) return cached;
  const fallback = { name: new URL(shopUrl).host, currency: "" };
  try {
    const res = await fetchImpl(`${shopUrl}/meta.json`);
    if (!res.ok) return fallback;
    const body = (await res.json()) as { name?: string; currency?: string };
    const meta = { name: body.name || fallback.name, currency: body.currency ?? "" };
    metaCache.set(shopUrl, meta);
    return meta;
  } catch {
    return fallback;
  }
}

/** The bare numeric product id: the shop's UCP endpoint returns a gid and the merchant tool keys the number. */
export function bareProductId(productId: string): string {
  return productId.split("/").pop() ?? productId;
}

const fieldsCache = new Map<string, PersonalizationField[] | null>();

/** The default reader: one headless store page, one `get_customization` call per product. */
async function readFieldsThroughStorePage(pageUrl: string, productIds: string[]): Promise<Map<string, PersonalizationField[] | null>> {
  const { withStorePage } = await import("../server/store-page");
  const { parseCustomization } = await import("../server/customization");
  return withStorePage(pageUrl, async (page) => {
    const out = new Map<string, PersonalizationField[] | null>();
    for (const id of productIds) {
      const reply = await page.call("get_customization", { product_id: id });
      out.set(id, reply.isError ? null : parseCustomization(reply.payload, "").fields);
    }
    return out;
  });
}

/** The fields per product id, read for the ids the cache lacks and remembered for the process. */
async function storeFields(shopUrl: string, productIds: string[], read: FieldsReader): Promise<Map<string, PersonalizationField[] | null>> {
  const missing = productIds.filter((id) => !fieldsCache.has(id));
  if (missing.length) {
    try {
      for (const [id, fields] of await read(shopUrl, missing)) fieldsCache.set(id, fields);
    } catch (e) {
      // A store page that does not answer leaves this search without fields and the next search tries again.
      console.warn(`Reading the custom shop's customization failed: ${(e as Error).message}`);
    }
  }
  return new Map(productIds.map((id) => [id, fieldsCache.get(id) ?? null]));
}

function toCandidate(product: CatalogProduct, host: string, url: string, shopName: string, fields: PersonalizationField[] | null): Candidate {
  const variants: Variant[] = (product.variants ?? []).map((v) => ({ id: v.id, title: v.title ?? "", price_cents: v.price?.amount !== undefined ? Number(v.price.amount) : null, currency: v.price?.currency ?? null, available: v.availability?.available !== false, options: (v.options ?? []).map((o) => ({ name: String(o.name), label: String(o.label) })) }));
  const desc = typeof product.description === "string" ? product.description : ((product.description as { plain?: string; html?: string } | undefined)?.plain ?? (product.description as { html?: string } | undefined)?.html ?? "");
  const pr = product.price_range as { min?: { amount?: number; currency?: string } } | undefined;
  return {
    product_id: product.id,
    title: product.title,
    description: desc,
    url: (product.url as string | undefined) ?? url,
    image_url: (product.variants ?? []).flatMap((v) => v.media ?? []).find((m) => m.url)?.url ?? null,
    shop_domain: host,
    shop_name: shopName,
    shop_url: url,
    policy_links: [],
    price_cents: pr?.min?.amount !== undefined ? Number(pr.min.amount) : (variants[0]?.price_cents ?? null),
    currency: pr?.min?.currency ?? variants[0]?.currency ?? null,
    variants,
    option_names: [...new Set(variants.flatMap((v) => v.options.map((o) => o.name)))],
    searches: [CUSTOMSHOP_SOURCE],
    delivery: null,
    ...(fields?.length ? { personalization: { fields } } : {})
  };
}

/**
 * Every product the shop's own search lists, with the fields the shop's `get_customization`
 * answers and the shared checkout probe's delivery verdict. Returns nothing without a configured
 * shop, so a run degrades to the other sources.
 */
export async function customshopCandidates(ctx: EventContext, options: { client?: CatalogClient; fetchImpl?: typeof fetch; funnel?: Funnel; readFields?: FieldsReader } = {}): Promise<Candidate[]> {
  const url = customshopUrl();
  if (!url) return [];
  const host = new URL(url).host;
  const client = (options.client ?? catalogClient({ fetchImpl: options.fetchImpl })).withEndpoint(storefrontEndpoint(host));
  const result = await client.searchCatalog({ pagination: { limit: 50 } });
  const products = result.products ?? [];
  const meta = await storeMeta(url, options.fetchImpl);
  const fields = await storeFields(url, products.map((p) => bareProductId(p.id)), options.readFields ?? readFieldsThroughStorePage);
  const candidates = await Promise.all(products.map((p) => withDelivery(toCandidate(p, host, url, meta.name, fields.get(bareProductId(p.id)) ?? null), ctx, options.fetchImpl ?? fetch)));
  options.funnel?.searches.push({ query: CUSTOMSHOP_SOURCE, returned: products.length, total: (result.pagination as { total_count?: number } | undefined)?.total_count ?? products.length });
  return candidates;
}
