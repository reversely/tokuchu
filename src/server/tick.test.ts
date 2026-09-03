import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import { createEventFromBody, snapshot, submitRsvp } from "./api";
import { messagesFor } from "./chat";
import { createSchedule, listSchedules } from "./schedules";
import { pendingTick, tick, tickAfterRead, tickAll } from "./tick";

const NOW = new Date("2026-09-02T14:00:00Z");

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" },
  cost_per_person_cents: 5000
};

/** A Model that answers every turn with one final message and records what it was asked. */
function scriptedModel(text: string): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async getResponse(request) {
      requests.push(request);
      const output: ModelResponse["output"] = [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }];
      return { usage: new Usage(), output };
    },
    // eslint-disable-next-line require-yield
    async *getStreamedResponse() {
      throw new Error("streaming is not scripted");
    }
  };
}

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }, { display_name: "Blake Rivera", status: "maybe" }] });
  return event;
}

describe("the tick over a fake clock (#33)", () => {
  beforeEach(resetState);

  it("runs only the rows whose time has come, skips a cancelled one, and reschedules the repeat", async () => {
    const event = seed();
    const due = createSchedule(event.id, { action: "status", description: "status at 10", run_at: "2026-09-02T14:00:00Z" }, NOW);
    const repeat = createSchedule(event.id, { action: "status", description: "every morning", run_at: "2026-09-02T13:00:00Z", every_minutes: 1440 }, NOW);
    const later = createSchedule(event.id, { action: "status", description: "status at 11", run_at: "2026-09-02T15:00:00Z" }, NOW);
    const cancelled = createSchedule(event.id, { action: "status", description: "cancelled", run_at: "2026-09-02T13:30:00Z" }, NOW);
    const { cancelSchedule } = await import("./schedules");
    cancelSchedule(event.id, cancelled.id, NOW);

    const posted = await tick(event.id, { now: NOW, llm: false });
    expect(posted.map((m) => m.schedule_id)).toEqual([repeat.id, due.id]);
    expect(posted[0].text).toBe("Status: 1 going, 1 maybe, 0 not going, 0 without a reply.");
    const rows = Object.fromEntries(listSchedules(event.id, true).map((s) => [s.id, s]));
    expect(rows[due.id].last_run_at).toBe(NOW.toISOString());
    expect(rows[repeat.id]).toMatchObject({ run_at: "2026-09-03T13:00:00.000Z", last_run_at: NOW.toISOString() });
    expect(rows[later.id].last_run_at).toBeNull();
    expect(rows[cancelled.id].last_run_at).toBeNull();

    // The same minute again runs nothing; an hour on runs the later row once.
    expect(await tick(event.id, { now: NOW, llm: false })).toEqual([]);
    const hour = new Date("2026-09-02T15:00:00Z");
    expect((await tick(event.id, { now: hour, llm: false })).map((m) => m.schedule_id)).toEqual([later.id]);
    expect(await tick(event.id, { now: hour, llm: false })).toEqual([]);
    // The next morning the repeat runs again.
    expect((await tick(event.id, { now: new Date("2026-09-03T13:00:00Z"), llm: false })).map((m) => m.schedule_id)).toEqual([repeat.id]);
    expect(messagesFor(event.id)).toHaveLength(4);
  });

  it("writes the status through the agent with a write-it-now prompt when the model is on", async () => {
    const event = seed();
    const row = createSchedule(event.id, { action: "status", description: "post me a status", run_at: NOW.toISOString() }, NOW);
    const model = scriptedModel("One guest is going and one is a maybe; ask Blake to decide.");
    const [posted] = await tick(event.id, { now: NOW, llm: true, model });
    expect(posted).toMatchObject({ role: "system", schedule_id: row.id, text: "One guest is going and one is a maybe; ask Blake to decide." });
    const asked = model.requests[0].input as { role?: string; content?: unknown }[];
    expect(JSON.stringify(asked)).toMatch(/Write the status now/);
  });

  it("starts one tick from the snapshot read and a second read during it starts nothing", async () => {
    const event = seed();
    createSchedule(event.id, { action: "status", description: "status now", run_at: "2026-09-02T13:00:00Z" }, NOW);
    snapshot(event.id);
    snapshot(event.id);
    await pendingTick(event.id);
    snapshot(event.id);
    await pendingTick(event.id);
    const lines = messagesFor(event.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^Status: 1 going/);
  });

  it("sweeps every event in memory for the cron endpoint", async () => {
    const one = seed();
    const two = seed();
    createSchedule(one.id, { action: "status", description: "s", run_at: "2026-09-02T13:00:00Z" }, NOW);
    createSchedule(two.id, { action: "status", description: "s", run_at: "2026-09-02T13:00:00Z" }, NOW);
    createSchedule(two.id, { action: "status", description: "later", run_at: "2026-09-02T18:00:00Z" }, NOW);
    expect(await tickAll({ now: NOW, llm: false })).toEqual({ events: 2, runs: 2 });
    expect(await tickAll({ now: NOW, llm: false })).toEqual({ events: 2, runs: 0 });
  });
});
