/**
 * The stored reconciliations (#51): one row per gift per version of its store's requirement schema,
 * holding the decision per requirement with who confirmed it, the model's verdicts, and the
 * organizer's confirmations. A new schema version opens a row that carries the diff from the
 * version before until the organizer continues past it; the reconciliation service (server/reconcile.ts)
 * reads and writes the rows through the functions here.
 */
import type { SchemaDiff } from "./requirement-schema";
import { newId, state } from "./store";
import type { Reconciliation } from "./types";

const now = () => new Date().toISOString();

export const reconciliationKey = (giftId: string, schemaId: string, version: string) => `${giftId}|${schemaId}|${version}`;

/** The rows for a gift, the most recently written first. */
export function reconciliationsFor(giftId: string): Reconciliation[] {
  return [...state().reconciliations.values()].filter((r) => r.gift_id === giftId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** The row for a gift at one schema version, created empty when none exists. */
export function reconciliationFor(giftId: string, schemaId: string, version: string): Reconciliation {
  const s = state();
  const key = reconciliationKey(giftId, schemaId, version);
  const existing = s.reconciliations.get(key);
  if (existing) return existing;
  const gift = s.gifts.get(giftId);
  if (!gift) throw new Error(`No gift ${giftId}.`);
  const row: Reconciliation = { id: newId("rec"), event_id: gift.event_id, gift_id: giftId, schema_id: schemaId, schema_version: version, decisions: [], verdicts: {}, confirmations: {}, previous: null, updated_at: now() };
  s.reconciliations.set(key, row);
  return row;
}

/** Replaces the row's fields; every write replaces the row so a transaction's snapshot stays valid. */
export function updateReconciliation(row: Reconciliation, patch: Partial<Pick<Reconciliation, "decisions" | "verdicts" | "confirmations" | "previous">>): Reconciliation {
  const next: Reconciliation = { ...row, ...patch, updated_at: now() };
  state().reconciliations.set(reconciliationKey(row.gift_id, row.schema_id, row.schema_version), next);
  return next;
}

/**
 * A gift that adopts a schema id or version without a diff (its first read from the store) keeps
 * the confirmations and verdicts recorded under the earlier key: the latest row moves to the new key.
 */
export function adoptSchemaVersion(giftId: string, schemaId: string, version: string): Reconciliation | undefined {
  const s = state();
  const key = reconciliationKey(giftId, schemaId, version);
  if (s.reconciliations.has(key)) return s.reconciliations.get(key);
  const latest = reconciliationsFor(giftId)[0];
  if (!latest) return undefined;
  s.reconciliations.delete(reconciliationKey(latest.gift_id, latest.schema_id, latest.schema_version));
  const moved: Reconciliation = { ...latest, schema_id: schemaId, schema_version: version, updated_at: now() };
  s.reconciliations.set(key, moved);
  return moved;
}

/**
 * Opens the row for a new schema version with the diff from the version before. The confirmations
 * for requirements the new version still carries come along; the verdicts and decisions start over.
 */
export function recordSchemaChange(giftId: string, schemaId: string, fromVersion: string, toVersion: string, diff: SchemaDiff): Reconciliation {
  const before = state().reconciliations.get(reconciliationKey(giftId, schemaId, fromVersion));
  const gone = new Set([...diff.removed, ...diff.changed]);
  const kept = Object.fromEntries(Object.entries(before?.confirmations ?? {}).filter(([key]) => !gone.has(key)));
  const row = reconciliationFor(giftId, schemaId, toVersion);
  return updateReconciliation(row, { decisions: [], verdicts: {}, confirmations: kept, previous: { schema_version: fromVersion, diff: { added: diff.added, removed: diff.removed, changed: diff.changed }, changed_at: now(), continued_at: null } });
}

/** The organizer continues past the schema change: the row keeps the diff with the time of the continuation. */
export function continuePastSchemaChange(giftId: string, schemaId: string, version: string): Reconciliation {
  const row = reconciliationFor(giftId, schemaId, version);
  if (!row.previous || row.previous.continued_at) return row;
  return updateReconciliation(row, { previous: { ...row.previous, continued_at: now() } });
}
