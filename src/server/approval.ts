/**
 * Approval tied to a revision (#44). An approval records the change-log seq of its own entry as the
 * approved revision; a fulfilment-affecting change after it leaves the approval stale until the
 * organizer approves again. The manifest and the Procurement summary carry both revisions, and the
 * Attendees tab shows the stale state with a re-approve action.
 */
import { currentRevision, procurementChanges } from "../domain/procurement";
import type { Batch, ChangeEntry, ProcurementChangeType } from "../domain/types";

export type ApprovalState = {
  /** The revision the organizer approved, or null before any approval. */
  approved_revision: number | null;
  /** The revision the procurement stands at. */
  current_revision: number;
  /** True when a fulfilment-affecting change came after the approved revision. */
  stale: boolean;
  /** How many such changes came after it. */
  changes_since: number;
};

/** The procurement-level changes that affect fulfilment: a mapping or plan edit, a schema change, and an opened exception. */
const AFFECTING: ReadonlySet<ProcurementChangeType> = new Set(["mapping_changed", "plan_changed", "exception_opened"]);

/**
 * True when the entry changes what the store would fulfil: a value on a mapped definition, a reply
 * change, or a procurement change from the affecting set. A progress-log post, an approval, a
 * status move, and a closed exception leave the approved values as they were.
 */
export function affectsFulfilment(entry: ChangeEntry): boolean {
  switch (entry.kind) {
    case "value":
    case "status":
      return true;
    case "update":
      return false;
    case "procurement":
      return AFFECTING.has(entry.type);
  }
}

/** Where the gift's approval stands against its change log; the organizer's view, so every mapped definition counts. */
export function approvalState(gift: Batch): ApprovalState {
  const approved = gift.approved_at && typeof gift.approved_seq === "number" ? gift.approved_seq : null;
  const since = approved === null ? [] : procurementChanges(gift.id, approved).filter(affectsFulfilment);
  return { approved_revision: approved, current_revision: currentRevision(gift.id), stale: since.length > 0, changes_since: since.length };
}
