/**
 * The store's customization contract for a product, read through the merchant tool
 * `get_customization` on a headless store page. The gift creation path calls it when the organizer
 * confirms a product of a shop that answers the merchant tools, so the gift carries the store's
 * fields with their constraints and the store's variants with the numeric ids the cart tool takes.
 */
import { customshopHost, customshopUrl, storeMeta } from "../agent/customshop";
import { PERSONALIZATION_KINDS, PersonalizationField, type Variant } from "../domain/types";
import { BadRequestError } from "./errors";
import { withStorePage, type StorePage } from "./store-page";

export type StoreCustomization = { title: string; fields: PersonalizationField[]; variants: Variant[]; selected_variant_id: string | null };

type ToolVariant = { id: string; title: string; price_cents: number; available: boolean; options: { name: string; label: string }[] };
type ToolPayload = { title?: string; fields?: unknown[]; variants?: ToolVariant[]; selected_variant_id?: string | null };

const KNOWN_KINDS = new Set<string>(PERSONALIZATION_KINDS);

/** True when the shop publishes the merchant tools: today the configured custom shop alone. */
export function answersMerchantTools(shopDomain: string | null | undefined): boolean {
  const host = customshopHost();
  return host !== null && (shopDomain ?? "").replace(/^https?:\/\//, "") === host;
}

/** The store's payload as the gift stores it; a field of a kind the app does not resolve stays out, since no mapping could fill it. */
export function parseCustomization(payload: Record<string, unknown>, currency: string): StoreCustomization {
  const raw = payload as ToolPayload;
  const fields: PersonalizationField[] = [];
  for (const entry of raw.fields ?? []) {
    const kind = (entry as { kind?: string }).kind ?? "";
    if (!KNOWN_KINDS.has(kind)) continue;
    const parsed = PersonalizationField.safeParse(entry);
    if (parsed.success) fields.push(parsed.data);
  }
  const variants: Variant[] = (raw.variants ?? []).map((v) => ({ id: String(v.id), title: v.title, price_cents: v.price_cents, currency, available: v.available, options: v.options }));
  return { title: raw.title ?? "", fields, variants, selected_variant_id: raw.selected_variant_id ?? variants[0]?.id ?? null };
}

/**
 * Calls `get_customization` on an open store page.
 *
 * Raises:
 *   BadRequestError: when the store answers with an error, such as a product it has no customization for.
 */
export async function readCustomization(page: StorePage, productId: string, currency: string): Promise<StoreCustomization> {
  const reply = await page.call("get_customization", { product_id: productId });
  if (reply.isError) throw new BadRequestError(`The store answered get_customization with ${String(reply.payload.error ?? "an error")}.`);
  return parseCustomization(reply.payload, currency);
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
  const customization = await read(gift.product_url || shopUrl, gift.product_id, meta.currency);
  const known = new Set(customization.variants.map((v) => v.id));
  const mapping = (gift.mapping ?? []).filter((row) => known.has(row.variant_id));
  const defaultVariant = gift.default_variant_id && known.has(gift.default_variant_id) ? gift.default_variant_id : customization.selected_variant_id;
  return { ...gift, variants: customization.variants, mapping, default_variant_id: defaultVariant, personalization: { fields: customization.fields } };
}

function readThroughStorePage(pageUrl: string, productId: string, currency: string): Promise<StoreCustomization> {
  return withStorePage(pageUrl, (page) => readCustomization(page, productId, currency));
}
