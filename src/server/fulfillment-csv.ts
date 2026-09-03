/**
 * The fulfilment manifest as CSV (#52): the same projection and the same grant filter as
 * get_fulfillment_manifest, one row per attendee, the fixed columns first and then one column per
 * requirement key the caller may see, in the store's schema order.
 */
import { fulfillmentManifest, type FulfillmentManifest } from "./procurement";
import { requireGift } from "./api";
import { vendorSchemaFor } from "./reconcile";

export const FIXED_COLUMNS = ["attendee_ref", "status", "variant_id"] as const;
export const ISSUES_COLUMN = "issues";

export type FulfillmentCsv = { columns: string[]; rows: string[][]; text: string; filename: string };

/** A value's text in a cell: empty for none, the items joined for a list. */
export function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : Array.isArray(value) ? value.map(String).join("; ") : String(value);
}

/** One CSV field: quoted when it holds a comma, a quote, or a line break, with quotes doubled. */
export function csvField(value: unknown): string {
  const text = cellText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The requirement keys the manifest carries, in the store's schema order, then any the schema does not name. */
export function manifestColumns(manifest: FulfillmentManifest, schemaKeys: string[]): string[] {
  const present = new Set(manifest.attendees.flatMap((a) => Object.keys(a.values)));
  const ordered = schemaKeys.filter((key) => present.has(key));
  const rest = [...present].filter((key) => !schemaKeys.includes(key)).sort();
  return [...ordered, ...rest];
}

/** The CSV for a gift as the caller may see it; `readable` absent is the organizer's view. */
export function fulfillmentCsv(eventId: string, giftId: string, readable?: string[]): FulfillmentCsv {
  const gift = requireGift(eventId, giftId);
  const manifest = fulfillmentManifest(eventId, giftId, readable);
  const keys = manifestColumns(manifest, vendorSchemaFor(gift).requirements.map((r) => r.key));
  const columns = [...FIXED_COLUMNS, ...keys, ISSUES_COLUMN];
  const rows = manifest.attendees.map((a) => [a.attendee_ref, a.status, a.variant_id ?? "", ...keys.map((k) => cellText(a.values[k])), a.issues.map((i) => `${i.requirement_id}: ${i.message}`).join("; ")]);
  const text = [columns, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
  return { columns, rows, text, filename: `fulfillment-${giftId}-r${manifest.revision}.csv` };
}

/** The CSV as an HTTP response the browser saves. */
export function csvResponse(csv: FulfillmentCsv): Response {
  return new Response(csv.text, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${csv.filename}"`, "Cache-Control": "no-store" } });
}
