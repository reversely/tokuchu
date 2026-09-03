/**
 * The store's customization contract for a product, read through the merchant tool
 * `get_customization` on a headless store page. The gift creation path calls it when the organizer
 * confirms a product of a shop that answers the merchant tools, so the gift carries the store's
 * fields with their constraints and the store's variants with the numeric ids the cart tool takes.
 */
import { customshopHost, customshopUrl, storeMeta } from "../agent/customshop";
import { deriveSchemaId, deriveSchemaVersion, type VendorRequirementSchema } from "../domain/requirement-schema";
import { PERSONALIZATION_KINDS, PersonalizationField, type Variant } from "../domain/types";
import { BadRequestError } from "./errors";
import { withStorePage, type StorePage } from "./store-page";

export type StoreCustomization = { title: string; fields: PersonalizationField[]; variants: Variant[]; selected_variant_id: string | null; schema: VendorRequirementSchema };

type ToolVariant = { id: string; title: string; price_cents: number; available: boolean; options: { name: string; label: string }[] };
type ToolPayload = { title?: string; fields?: unknown[]; variants?: ToolVariant[]; selected_variant_id?: string | null; schema_id?: string; schema_version?: string; version?: string; product_id?: string };

/** Where the payload came from, for the schema's identity when the store states none. */
export type SchemaOrigin = { store_domain: string; product_id: string };

const KNOWN_KINDS = new Set<string>(PERSONALIZATION_KINDS);

/** True when the shop publishes the merchant tools: today the configured custom shop alone. */
export function answersMerchantTools(shopDomain: string | null | undefined): boolean {
  const host = customshopHost();
  return host !== null && (shopDomain ?? "").replace(/^https?:\/\//, "") === host;
}

/** The store's fields as a versioned schema: the store's own id and version when it states them, and otherwise the store domain plus product id and a hash of the fields. */
export function normalizeSchema(raw: Pick<ToolPayload, "schema_id" | "schema_version" | "version" | "product_id">, fields: PersonalizationField[], origin: SchemaOrigin): VendorRequirementSchema {
  const productId = raw.product_id ?? origin.product_id;
  return { schema_id: raw.schema_id ?? deriveSchemaId(origin.store_domain, productId), version: raw.schema_version ?? raw.version ?? deriveSchemaVersion(fields), ...(productId ? { product_id: productId } : {}), requirements: fields };
}

/** The store's payload as the gift stores it; a field of a kind the app does not resolve stays out, since no mapping could fill it. */
export function parseCustomization(payload: Record<string, unknown>, currency: string, origin: SchemaOrigin = { store_domain: "", product_id: "" }): StoreCustomization {
  const raw = payload as ToolPayload;
  const fields: PersonalizationField[] = [];
  for (const entry of raw.fields ?? []) {
    const kind = (entry as { kind?: string }).kind ?? "";
    if (!KNOWN_KINDS.has(kind)) continue;
    const parsed = PersonalizationField.safeParse(entry);
    if (parsed.success) fields.push(parsed.data);
  }
  const variants: Variant[] = (raw.variants ?? []).map((v) => ({ id: String(v.id), title: v.title, price_cents: v.price_cents, currency, available: v.available, options: v.options }));
  return { title: raw.title ?? "", fields, variants, selected_variant_id: raw.selected_variant_id ?? variants[0]?.id ?? null, schema: normalizeSchema(raw, fields, origin) };
}

/**
 * Calls `get_customization` on an open store page.
 *
 * Raises:
 *   BadRequestError: when the store answers with an error, such as a product it has no customization for.
 */
export async function readCustomization(page: StorePage, productId: string, currency: string, storeDomain = ""): Promise<StoreCustomization> {
  const reply = await page.call("get_customization", { product_id: productId });
  if (reply.isError) throw new BadRequestError(`The store answered get_customization with ${String(reply.payload.error ?? "an error")}.`);
  return parseCustomization(reply.payload, currency, { store_domain: storeDomain, product_id: productId });
}

/** How long one product's customization answer serves later gift writes before the store page is read again. */
const CUSTOMIZATION_TTL_MS = 5 * 60 * 1000;
const recent = new Map<string, { at: number; value: StoreCustomization }>();

/**
 * The store's customization for one product, read once and reused for five minutes. Each read opens
 * a browser on the store page, which takes tens of seconds and most of a small instance's memory, and
 * a second gift write for the same product within minutes gets the same answer.
 */
async function cachedRead(read: typeof readThroughStorePage, pageUrl: string, productId: string, currency: string): Promise<StoreCustomization> {
  const key = `${pageUrl}|${productId}|${currency}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CUSTOMIZATION_TTL_MS) return hit.value;
  const value = await read(pageUrl, productId, currency);
  recent.set(key, { at: Date.now(), value });
  return value;
}

type GiftBodyShape = { product_id?: string; shop_domain?: string; product_url?: string | null; variants?: Variant[]; mapping?: { variant_id: string }[]; default_variant_id?: string | null };

/**
 * The gift body with the store's fields and variants in place of the catalog's when the shop answers
 * the merchant tools; any other shop's body passes through unchanged. Mapping rows that name a
 * catalog variant the store does not list drop, since the store's ids replace the catalog's.
 */
export async function withStoreCustomization(body: unknown, read = readThroughStorePage): Promise<unknown> {
  const gift = (body ?? {}) as GiftBodyShape;
  if (!gift.product_id || !answersMerchantTools(gift.shop_domain)) return body;
  const shopUrl = customshopUrl()!;
  const meta = await storeMeta(shopUrl);
  const customization = await cachedRead(read, gift.product_url || shopUrl, gift.product_id, meta.currency);
  const known = new Set(customization.variants.map((v) => v.id));
  const mapping = (gift.mapping ?? []).filter((row) => known.has(row.variant_id));
  const defaultVariant = gift.default_variant_id && known.has(gift.default_variant_id) ? gift.default_variant_id : customization.selected_variant_id;
  return { ...gift, variants: customization.variants, mapping, default_variant_id: defaultVariant, personalization: { fields: customization.fields, schema_id: customization.schema.schema_id, schema_version: customization.schema.version } };
}

function readThroughStorePage(pageUrl: string, productId: string, currency: string): Promise<StoreCustomization> {
  return withStorePage(pageUrl, (page) => readCustomization(page, productId, currency, new URL(pageUrl).host));
}
