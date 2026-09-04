"use client";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "./dashboard";
import type { FulfillmentAttendee, FulfillmentManifest, IssueStatus } from "../../../server/procurement";
import type { ProcurementException } from "../../../domain/types";
import { withDemoHeaders } from "../../../demo/token";

type Definition = Snapshot["definitions"][number];
type RequestView = Snapshot["requests"][number];

/** The state a grid cell shows: a requirement's resolution status from the manifest row, or not given for a value nobody asked for. */
export type CellState = IssueStatus | "resolved" | "not_given";

/** The seven requirement states in the order the legend lists them, each with the words the cell shows and the legend's explanation. */
export const CELL_STATES: { state: Exclude<CellState, "not_given" | "exception">; label: string; explains: string }[] = [
  { state: "resolved", label: "resolved", explains: "the value passed the store's constraints and is ready to send" },
  { state: "missing", label: "missing", explains: "the attendee has not given the value yet" },
  { state: "invalid", label: "invalid", explains: "the value fails a constraint the store set and the cell names it" },
  { state: "mapping_unresolved", label: "mapping unresolved", explains: "the store changed this requirement and its mapping needs settling again" },
  { state: "needs_confirmation", label: "needs confirmation", explains: "the mapping waits for the organizer to confirm it" },
  { state: "vendor_rejected", label: "rejected by the store", explains: "the store sent the value back with a message" },
  { state: "changed_after_approval", label: "changed after approval", explains: "the attendee changed the value after the organizer approved" }
];

const CELL_LABEL: Record<CellState, string> = Object.fromEntries([...CELL_STATES.map((s) => [s.state, s.label]), ["exception", "exception"], ["not_given", "not given"]]) as Record<CellState, string>;

/** The store's requirement key a definition fills: the vendor field it came from or its own key for the variant question. */
export const requirementKey = (def: Definition): string => def.vendor_field?.key ?? def.key;

/** The organizer's fulfilment manifest for the gift, read again on every snapshot sequence. Null before the first read and for a gift without one. */
export function useFulfillmentManifest(eventId: string, giftId: string | undefined, seq: number): FulfillmentManifest | null {
  const [manifest, setManifest] = useState<FulfillmentManifest | null>(null);
  const load = useCallback(async () => {
    if (!giftId) return setManifest(null);
    try {
      const res = await fetch(`/api/events/${eventId}/gifts/${giftId}/fulfillment`, withDemoHeaders({ cache: "no-store" }));
      setManifest(res.ok ? ((await res.json()) as FulfillmentManifest) : null);
    } catch {
      setManifest(null);
    }
  }, [eventId, giftId]);
  useEffect(() => { void load(); }, [load, seq]);
  return manifest;
}

export type Cell = { state: CellState; value: unknown; message: string | null };

const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * One cell's state for a definition column. The manifest row grades the requirement; before the
 * manifest arrives the guest's own value stands in as resolved or missing. A blank value no issue
 * names was never asked for.
 */
export function cellState(def: Definition, value: unknown, row: FulfillmentAttendee | undefined, going: boolean): Cell {
  const key = requirementKey(def);
  const issue = row?.issues.find((i) => i.requirement_id === key);
  if (issue) return { state: issue.status, value: row?.values[key] ?? value, message: issue.message };
  const shown = row ? row.values[key] : value;
  if (!blank(shown)) return { state: "resolved", value: shown, message: null };
  const required = def.required_rule === "always" || (def.required_rule === "going" && going);
  return { state: !row && required ? "missing" : "not_given", value: null, message: null };
}

/** The value a cell shows in the organizer's words: an option's label for a choice and the value itself otherwise. */
function valueLabel(def: Definition, value: unknown): string {
  if (Array.isArray(value)) return (value as string[]).map((x) => def.constraints.options?.find((o) => o.value === x)?.label ?? x).join(" ");
  if (blank(value)) return "";
  return def.constraints.options?.find((o) => o.value === value)?.label ?? String(value);
}

/** A grid cell: the resolved value on its own; any other state named with the value it grades and the constraint or message behind it. */
export function GridCell({ def, cell }: { def: Definition; cell: Cell }) {
  const label = valueLabel(def, cell.value);
  const shown = def.value_type === "file" && label ? <a href={label} target="_blank" rel="noreferrer">picture</a> : label;
  if (cell.state === "resolved") return <span className="answered" data-state="resolved">{shown}</span>;
  if (cell.state === "not_given") return <span className="quiet" data-state="not_given">not given</span>;
  return (
    <span className="cellstate" data-state={cell.state}>
      {label && <span className="cellvalue">{shown}</span>}
      <span className={`state ${cell.state}`}>{CELL_LABEL[cell.state]}</span>
      {cell.message && <span className="quiet cellwhy" data-testid="cell-why">{cell.message}</span>}
    </span>
  );
}

const STATUS_WORDS = (s: string) => s.replace(/_/g, " ");

/** The Procurement's status with the revision it stands at and the one the organizer approved. */
export function ProcurementState({ procurement, current, approved }: { procurement: Snapshot["procurements"][number] | undefined; current: number; approved: number | null }) {
  const status = procurement?.status ?? "draft";
  return (
    <div className="chips" style={{ marginBottom: 14 }} data-testid="procurement-state" data-status={status} data-current={current} data-approved={approved ?? ""}>
      <span className={`pill${status === "ready" || status === "approved" || status === "checkout_ready" ? " live" : ""}`} data-testid="procurement-status">{STATUS_WORDS(status)}</span>
      <span className="tag quiet" data-testid="procurement-revision">revision {current}</span>
      <span className="tag quiet" data-testid="procurement-approved">{approved === null ? "not approved" : `approved at revision ${approved}`}</span>
    </div>
  );
}

/** The legend under the grid: each requirement state with what it means. */
export function GridLegend() {
  return (
    <ul className="legend" data-testid="records-legend" aria-label="What each cell state means">
      {CELL_STATES.map((s) => (
        <li key={s.state} data-state={s.state}>
          <span className={`state ${s.state}`}>{s.label}</span>
          <span className="quiet">{s.explains}</span>
        </li>
      ))}
    </ul>
  );
}

/** Where the correction request for an exception stands: never sent when no question carries it, sent, followed up, or answered once the answer resolved the exception. */
export type CorrectionState = "not_sent" | "sent" | "followed_up" | "answered";
const CORRECTION_LABEL: Record<CorrectionState, string> = { not_sent: "no correction sent", sent: "correction sent", followed_up: "followed up", answered: "answered" };

export function correctionState(exception: ProcurementException, def: Definition | undefined, request: RequestView | undefined): CorrectionState {
  if (exception.status === "resolved") return "answered";
  if (!def || !request?.definition_ids.includes(def.id)) return "not_sent";
  return request.follow_ups > 0 ? "followed_up" : "sent";
}

/** The store's words for an exception: its message or the unavailable value with the values it offers. */
function exceptionText(e: ProcurementException): string {
  if (e.message) return e.message;
  if (e.type === "option_unavailable") return `${e.unavailable_value ?? "the value"} is unavailable${e.allowed_values?.length ? `; the store offers ${e.allowed_values.join(" or ")}` : ""}`;
  return STATUS_WORDS(e.type);
}

/**
 * The exceptions on the gift: every open one and each one an answer resolved. A row names the
 * attendee, the requirement, the store's message, and where the correction request stands.
 */
export function ExceptionsList({ exceptions, guests, definitions, requests }: { exceptions: ProcurementException[]; guests: Snapshot["guests"]; definitions: Definition[]; requests: Map<string, RequestView> }) {
  const listed = exceptions.filter((e) => e.status !== "dismissed");
  const open = listed.filter((e) => e.status === "open").length;
  if (listed.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }} data-testid="exceptions">
      <div className="labelrow"><h3 style={{ fontSize: 16 }}>Exceptions</h3><span className="eyebrow">{open} open</span></div>
      <div className="list">
        {listed.map((e) => {
          const def = e.requirement_id ? definitions.find((d) => requirementKey(d) === e.requirement_id) : undefined;
          const guest = e.attendee_ref ? guests.find((g) => g.id === e.attendee_ref) : undefined;
          const correction = correctionState(e, def, e.attendee_ref ? requests.get(e.attendee_ref) : undefined);
          return (
            <div className="row" key={e.id} style={{ gridTemplateColumns: "1fr auto" }} data-testid="exception" data-exception={e.id} data-status={e.status} data-correction={correction} data-attendee={e.attendee_ref ?? ""} data-requirement={e.requirement_id ?? ""}>
              <div>
                <div><strong data-testid="exception-attendee">{guest?.display_name ?? "The whole order"}</strong> <span className="quiet" data-testid="exception-requirement">{def?.label ?? e.requirement_id ?? "every requirement"}</span></div>
                <div className="hint" style={{ marginTop: 4 }} data-testid="exception-message">{exceptionText(e)}</div>
              </div>
              <span className={`pill${correction === "answered" ? " live" : ""}`} data-testid="exception-correction">{CORRECTION_LABEL[correction]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
