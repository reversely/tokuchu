import { beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import { createEventFromBody } from "../server/api";
import { listSchedules } from "../server/schedules";
import { SCHEDULE_LABELS, scheduleTools } from "./schedule-tools";

const NOW = new Date("2026-09-02T14:00:00Z");

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Vancouver", region: "BC", postal_code: "V6B 1A1", country: "CA" },
  cost_per_person_cents: 5000
};

/** Invokes one of the tools the way the agent runtime does and parses its JSON reply. */
async function invoke(eventId: string, name: string, args: Record<string, unknown>) {
  const sdk = await import("@openai/agents");
  const tool = scheduleTools(sdk, { eventId }, { now: () => NOW }).find((t) => t.name === name)!;
  const out = await tool.invoke(new sdk.RunContext({ eventId }), JSON.stringify(args));
  return typeof out === "string" ? (JSON.parse(out) as Record<string, unknown>) : out;
}

describe("the schedule tools (#33)", () => {
  beforeEach(resetState);

  it("offers the three tools with a label each", async () => {
    const sdk = await import("@openai/agents");
    expect(scheduleTools(sdk, { eventId: "evt" }).map((t) => t.name)).toEqual(["schedule", "list_schedules", "cancel_schedule"]);
    expect(Object.keys(SCHEDULE_LABELS)).toEqual(["schedule", "list_schedules", "cancel_schedule"]);
  });

  it("resolves the words in the venue's zone, stores the row, lists it, and cancels it", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const scheduled = (await invoke(event.id, "schedule", { action: "follow_up", when: "Friday at 9", description: "remind everyone who has not answered on Friday at 9", gift_id: null, text: null })) as { scheduled: Record<string, unknown> };
    expect(scheduled.scheduled).toMatchObject({ action: "follow_up", run_at: "2026-09-04T16:00:00.000Z", runs_at_local: "Fri, 2026-09-04, 09:00 PDT", zone: "America/Vancouver", every_minutes: null });
    const id = scheduled.scheduled.schedule_id as string;
    expect(listSchedules(event.id).map((s) => s.id)).toEqual([id]);

    const repeat = (await invoke(event.id, "schedule", { action: "status", when: "every morning", description: "post me a status every morning", gift_id: null, text: null })) as { scheduled: Record<string, unknown> };
    // At 07:00 in Vancouver the morning slot is still ahead today.
    expect(repeat.scheduled).toMatchObject({ run_at: "2026-09-02T16:00:00.000Z", every_minutes: 1440 });

    const listed = (await invoke(event.id, "list_schedules", { include_cancelled: null })) as { zone: string; schedules: { schedule_id: string }[] };
    expect(listed.zone).toBe("America/Vancouver");
    expect(listed.schedules.map((s) => s.schedule_id)).toEqual([repeat.scheduled.schedule_id, id]);

    const cancelled = (await invoke(event.id, "cancel_schedule", { schedule_id: id })) as { cancelled: Record<string, unknown> };
    expect(cancelled.cancelled).toMatchObject({ schedule_id: id, cancelled_at: NOW.toISOString() });
    expect(listSchedules(event.id).map((s) => s.id)).toEqual([repeat.scheduled.schedule_id]);
    expect(await invoke(event.id, "cancel_schedule", { schedule_id: "sch_none" })).toMatchObject({ error: expect.stringContaining("No schedule") });
  });

  it("answers with the question instead of a row when the time is open, and with the error for a message without text", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    expect(await invoke(event.id, "schedule", { action: "follow_up", when: "Friday at 5", description: "remind on Friday", gift_id: null, text: null })).toMatchObject({ ambiguous: true, question: "Is that 5 in the morning or the evening?", zone: "America/Vancouver" });
    expect(await invoke(event.id, "schedule", { action: "message", when: "tomorrow at 9", description: "tell everyone", gift_id: null, text: null })).toMatchObject({ error: "A message needs its text." });
    expect(listSchedules(event.id)).toEqual([]);
  });
});
