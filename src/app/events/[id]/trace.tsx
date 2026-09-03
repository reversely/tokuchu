"use client";
import type { TraceEntry } from "../../../domain/types";
import { dateTime } from "../../../lib/format";

const SIDE: Record<TraceEntry["side"], string> = { organizer: "Tokuchu", store: "Store", catalog: "Catalog" };

/** One entry, collapsed to its side and tool with the outcome and expandable to where it went and what it carried. */
function Entry({ entry }: { entry: TraceEntry }) {
  return (
    <details className="trace-entry" data-testid="trace-entry" data-side={entry.side} data-tool={entry.tool} data-ok={entry.ok ? "true" : "false"} data-gift={entry.gift_id ?? undefined}>
      <summary>
        <span className="trace-side">{SIDE[entry.side]}</span>
        <code>{entry.tool}</code>
        <span className={entry.ok ? "trace-ok" : "trace-fail"}>{entry.ok ? "ok" : "failed"} {entry.duration_ms} ms</span>
      </summary>
      <dl className="trace-detail">
        <dt>When</dt>
        <dd>{dateTime(entry.at)}</dd>
        <dt>Where</dt>
        <dd><code>{entry.endpoint}</code> over {entry.transport}{entry.caller ? ` as ${entry.caller}` : ""}</dd>
        <dt>Arguments</dt>
        <dd><pre>{entry.args || "none"}</pre></dd>
        <dt>Result</dt>
        <dd><pre>{entry.result || "none"}</pre></dd>
        {entry.gift_id && (
          <>
            <dt>Gift</dt>
            <dd><code>{entry.gift_id}</code></dd>
          </>
        )}
      </dl>
    </details>
  );
}

/** The entries newest first as the store returns them; an empty list says so. */
export function TraceList({ entries, empty = "No calls recorded yet" }: { entries: TraceEntry[]; empty?: string }) {
  return (
    <div className="trace-list" data-testid="trace-list">
      {entries.length === 0 && <p className="hint trace-empty">{empty}</p>}
      {entries.map((entry) => <Entry entry={entry} key={entry.id} />)}
    </div>
  );
}

/**
 * The Agent trace drawer (#55): a column beside the sheet's content on a wide screen and a drawer
 * over the page below 900px, listing every WebMCP and UCP call the event made or answered as the
 * four-second poll brings them in.
 */
export function TraceDrawer({ entries, onClose }: { entries: TraceEntry[]; onClose: () => void }) {
  return (
    <aside className="trace open" aria-label="Agent trace" data-testid="trace-drawer">
      <div className="trace-head">
        <h2>Agent trace</h2>
        <span className="trace-count" data-testid="trace-count">{entries.length} {entries.length === 1 ? "call" : "calls"}</span>
        <button type="button" className="btn ghost small trace-close" onClick={onClose} data-testid="trace-close">Close</button>
      </div>
      <TraceList entries={entries} />
    </aside>
  );
}

/** The newest few calls a heading concerns in one line: the tool and its outcome each. */
export function LastCalls({ entries, testId, limit = 3 }: { entries: TraceEntry[]; testId: string; limit?: number }) {
  const shown = entries.slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <p className="trace-inline" data-testid={testId}>
      <span className="trace-inline-label">Last calls</span>
      {shown.map((entry) => (
        <span className="trace-inline-call" key={entry.id} data-testid="trace-inline-call" data-tool={entry.tool} data-ok={entry.ok ? "true" : "false"}>
          <code>{entry.tool}</code> {entry.ok ? "ok" : "failed"} {entry.duration_ms} ms
        </span>
      ))}
    </p>
  );
}

/** The calls a gift concerns, newest first. */
export function tracesOfGift(entries: TraceEntry[], giftId: string): TraceEntry[] {
  return entries.filter((t) => t.gift_id === giftId);
}

/** The calls the last search made: the catalog and store endpoint calls that concern no gift yet. */
export function tracesOfSearch(entries: TraceEntry[]): TraceEntry[] {
  return entries.filter((t) => t.gift_id === null && t.transport !== "mcp" && t.transport !== "agent");
}
