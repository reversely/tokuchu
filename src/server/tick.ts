/**
 * The tick that runs due schedules (#33). `tick` runs them for one event under the current State;
 * `tickAfterRead` is the check the dashboard's snapshot read makes, which drives an open dashboard's
 * schedules at the poll's cadence; `tickAll` is the cron endpoint's sweep over every stored event.
 */
import type { Model } from "@openai/agents";
import { state } from "../domain/store";
import type { ChatMessage } from "../domain/types";
import { getDatabase, hasDatabase } from "./db";
import { llmEnabled, staticMode } from "./flags";
import { afterCommit, withPersistedEvent } from "./persistence";
import { dueSchedules, liveRunDeps, runSchedule, statusLine, type RunDeps } from "./schedules";

export type TickOptions = {
  now?: Date;
  /** Whether the status post comes from the agent; the LLM flag decides by default. */
  llm?: boolean;
  /** A scripted model for tests; ignored with the agent off. */
  model?: Model;
  /** Overrides for tests: the follow-up sender and the mailer. */
  deps?: Partial<Omit<RunDeps, "now" | "status">>;
};

const STATUS_PROMPT = "Write the status now. Read the event, the missing answers, the requests, and the gifts through your tools and write the organizer a status of at most four short sentences: the reply counts, what is still missing, each cart's state, and the one next step. Do not search for products or select a gift.";

/** The status writer: the agent when it is on, else the deterministic line from the snapshot. */
function statusWriter(options: TickOptions): RunDeps["status"] {
  if (!(options.llm ?? llmEnabled())) return async (eventId) => statusLine(eventId);
  return async (eventId) => {
    const { runCurationAgent } = await import("../agent/curation-agent");
    const result = await runCurationAgent({ eventId }, STATUS_PROMPT, options.model ? { model: options.model } : {});
    return result.response.trim() || statusLine(eventId);
  };
}

/** One tick per event at a time, so the four-second poll never starts a second run over the same due rows. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Runs every due schedule of one event in order and returns the lines they posted. A direct call
 * holds the event's in-flight slot while it runs, so a snapshot read made by a run starts nothing.
 */
export async function tick(eventId: string, options: TickOptions = {}): Promise<ChatMessage[]> {
  const now = options.now ?? new Date();
  const deps: RunDeps = { ...liveRunDeps(now, statusWriter(options)), ...options.deps };
  const holds = !inFlight.has(eventId);
  if (holds) inFlight.set(eventId, Promise.resolve());
  try {
    const posted: ChatMessage[] = [];
    for (const row of dueSchedules(eventId, now)) posted.push(await runSchedule(eventId, row, deps));
    return posted;
  } finally {
    if (holds) inFlight.delete(eventId);
  }
}

/**
 * The snapshot's check: with a due schedule and no tick running for the event, one tick starts once
 * the reading request has settled, in a persisted scope of its own so its posts land in the row.
 * The tick re-reads what is due, and each run moves its row on before acting, so a poll that lands
 * while a tick runs finds nothing to start.
 */
export function tickAfterRead(eventId: string, now: Date = new Date()): void {
  // Static mode runs no schedules (#56).
  if (staticMode() || inFlight.has(eventId) || !dueSchedules(eventId, now).length) return;
  const job = afterCommit()
    .then(() => withPersistedEvent(eventId, () => tick(eventId)))
    .then(() => undefined)
    .catch((e: unknown) => console.error(`The tick for event ${eventId} failed: ${(e as Error).message}`))
    .finally(() => inFlight.delete(eventId));
  inFlight.set(eventId, job);
}

/** Test hook: the tick a snapshot read started, so a test can wait for its posts. */
export function pendingTick(eventId: string): Promise<void> {
  return inFlight.get(eventId) ?? Promise.resolve();
}

/** Every stored event's id: the rows with the database, the in-memory map without. */
async function allEventIds(): Promise<string[]> {
  if (!hasDatabase()) return [...state().events.keys()];
  const rows = await (await getDatabase()).query("select id from events");
  return rows.map((r) => r.id as string);
}

/** The cron sweep: a tick for every event, each in its own persisted scope; a failing event is logged and the sweep goes on. */
export async function tickAll(options: TickOptions = {}): Promise<{ events: number; runs: number }> {
  const ids = await allEventIds();
  let runs = 0;
  for (const id of ids) {
    try {
      runs += (await withPersistedEvent(id, () => tick(id, options))).length;
    } catch (e) {
      console.error(`The tick for event ${id} failed: ${(e as Error).message}`);
    }
  }
  return { events: ids.length, runs };
}
