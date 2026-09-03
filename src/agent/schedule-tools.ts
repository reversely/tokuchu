/**
 * The assistant's schedule tools (#33): schedule, list_schedules, and cancel_schedule. Each wraps
 * the deterministic operations in server/schedules; the model only turns the organizer's words into
 * an action, a phrase for the time, and a description, and the parser resolves the phrase in the
 * event's zone. The curation agent registers these beside its own tools.
 */
import { z } from "zod";
import { ScheduleAction } from "../domain/types";
import { BadRequestError, NotFoundError, requireEvent } from "../server/api";
import { cancelSchedule, createSchedule, eventZone, formatLocal, listSchedules, resolveWhen } from "../server/schedules";
import type { CurationContext } from "./curation-agent";

type Sdk = typeof import("@openai/agents");

/** One-clause activity labels for the UI's running state, to spread into the agent's LABELS. */
export const SCHEDULE_LABELS: Record<string, string> = {
  schedule: "Scheduling the action",
  list_schedules: "Reading the schedule",
  cancel_schedule: "Cancelling the schedule"
};

export type ScheduleToolOptions = {
  /** The clock the phrases resolve against; tests pass a fixed one. */
  now?: () => Date;
};

/** A schedule as the model sees it: the row plus its run time in the event's zone. */
function view(row: ReturnType<typeof createSchedule>, zone: string) {
  return { schedule_id: row.id, action: row.action, description: row.description, gift_id: row.gift_id, text: row.text, run_at: row.run_at, runs_at_local: formatLocal(row.run_at, zone), zone, every_minutes: row.every_minutes, last_run_at: row.last_run_at, cancelled_at: row.cancelled_at };
}

/** The three tools, ready for the agent's tool list. */
export function scheduleTools({ tool }: Sdk, ctx: CurationContext, options: ScheduleToolOptions = {}) {
  const { eventId } = ctx;
  const now = options.now ?? (() => new Date());
  const zoneOf = () => eventZone(requireEvent(eventId).venue);
  return [
    tool({
      name: "schedule",
      description:
        "Schedules an action to run later: follow_up sends the pending requests again (to one gift's attendees with gift_id, or every gift's), status posts a status written at that moment, and message sends the text to the attendees the description names (everyone, everyone going, those who have not replied, or names) or posts it to the chat when it names nobody. `when` is the organizer's own words for the time (\"Friday at 9\", \"tomorrow at 17:00\", \"every morning\", \"every Monday at 9\", \"in 2 hours\", or an ISO time), resolved in the event's zone, which is chosen from the venue's country and region and is America/Toronto when they are unknown. When the reply says `ambiguous`, ask the organizer its question instead of guessing. Confirm the time from runs_at_local in the reply.",
      parameters: z.object({
        action: ScheduleAction,
        when: z.string().describe("The organizer's words for when it runs"),
        description: z.string().describe("The organizer's own words for the action, shown back in the chat"),
        gift_id: z.string().nullable().describe("The gift a follow_up is for, or null for every gift"),
        text: z.string().nullable().describe("The text a message sends or posts; null for the other actions")
      }),
      execute: async ({ action, when, description, gift_id, text }) => {
        const zone = zoneOf();
        const resolved = resolveWhen(when, zone, now());
        if ("ambiguous" in resolved) return { ambiguous: true, question: resolved.ambiguous, zone };
        try {
          return { scheduled: view(createSchedule(eventId, { action, description, run_at: resolved.run_at, gift_id, text, every_minutes: resolved.every_minutes }, now()), zone) };
        } catch (e) {
          if (e instanceof BadRequestError || e instanceof NotFoundError) return { error: e.message };
          throw e;
        }
      }
    }),
    tool({
      name: "list_schedules",
      description: "Lists the event's live schedules with each run time in the event's zone; include_cancelled adds the cancelled ones.",
      parameters: z.object({ include_cancelled: z.boolean().nullable().describe("true to include cancelled schedules") }),
      execute: async ({ include_cancelled }) => {
        const zone = zoneOf();
        return { zone, schedules: listSchedules(eventId, include_cancelled ?? false).map((row) => view(row, zone)) };
      }
    }),
    tool({
      name: "cancel_schedule",
      description: "Cancels one schedule by its schedule_id from list_schedules; the tick skips it from then on.",
      parameters: z.object({ schedule_id: z.string() }),
      execute: async ({ schedule_id }) => {
        try {
          return { cancelled: view(cancelSchedule(eventId, schedule_id, now()), zoneOf()) };
        } catch (e) {
          if (e instanceof NotFoundError) return { error: e.message };
          throw e;
        }
      }
    })
  ];
}
