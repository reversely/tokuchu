/**
 * The identity of a store's requirement schema: the normalized shape of a get_customization answer,
 * the id and version derived when the store gives none, and the diff between two versions. Every
 * function here is pure; procurement.ts applies a schema to a gift and its procurement.
 */
import { createHash } from "node:crypto";
import type { PersonalizationField } from "./types";

/** A store's requirements for one product as one versioned schema. */
export type VendorRequirementSchema = { schema_id: string; version: string; product_id?: string; requirements: PersonalizationField[] };

/** Which requirement keys a new version added, removed, or changed (a kind, a required flag, or a constraint). */
export type SchemaDiff = { added: string[]; removed: string[]; changed: string[] };

/** The store's domain plus the product id, the same value a procurement carries for a gift that got no id from the store. */
export function deriveSchemaId(storeDomain: string, productId: string): string {
  return `${storeDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${productId}`;
}

/** The parts of a field that decide whether a value fits it; a label change alone is not a new version. */
function fingerprint(field: PersonalizationField): string {
  const options = field.constraints?.options?.map((o) => o.value) ?? field.allowed_values ?? [];
  return JSON.stringify({ key: field.key, kind: field.kind, required: field.required, max_length: field.constraints?.max_length ?? field.max_length ?? null, options: [...options].sort() });
}

/** A stable hash over the requirement keys, kinds, and constraints, in key order, so two reads of the same schema give one version. */
export function deriveSchemaVersion(fields: PersonalizationField[]): string {
  const canonical = [...fields].sort((a, b) => a.key.localeCompare(b.key)).map(fingerprint).join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function diffRequirements(previous: PersonalizationField[], next: PersonalizationField[]): SchemaDiff {
  const before = new Map(previous.map((f) => [f.key, fingerprint(f)]));
  const after = new Map(next.map((f) => [f.key, fingerprint(f)]));
  const added = [...after.keys()].filter((key) => !before.has(key));
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const changed = [...after].filter(([key, print]) => before.has(key) && before.get(key) !== print).map(([key]) => key);
  return { added, removed, changed };
}

/** True when a diff touches no requirement. */
export function isUnchanged(diff: SchemaDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
