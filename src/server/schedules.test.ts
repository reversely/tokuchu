import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState, upsertDefinition } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { createEventFromBody, createGiftFromBody, requestFromAttendees, submitRsvp } from "./api";
import { messagesFor } from "./chat";
import { BadRequestError, NotFoundError } from "./errors";
import { setMailer, type MailMessage } from "./mail";
import { cancelSchedule, createSchedule, dueSchedules, eventZone, listSchedules, recipientsFor, resolveWhen, runSchedule, statusLine, type RunDeps } from "./schedules";

/** Wednesday 2026-09-02 at 10:00 in Toronto (14:00Z). */
const NOW = new Date("2026-09-02T14:00:00Z");
const TORONTO = "America/Toronto";

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" },
  cost_per_person_cents: 5000
};

const FIELDS: PersonalizationField[] = [{ key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }];

function fakeMailer() {
  const sent: MailMessage[] = [];
  setMailer({
    async send(message) {
      sent.push(message);
      return "sent";
    }
  });
  return sent;
}

/** A published event with two going guests who share an address, one without a reply, and one going guest without an address. */
function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }, { display_name: "Blake Rivera", status: "going" }] });
  submitRsvp(event.id, { party: {}, guests: [{ display_name: "Casey Park", status: "no_reply" }] });
  submitRsvp(event.id, { party: {}, guests: [{ display_name: "Devon Lee", status: "going" }] });
  return event;
}

function deps(now: Date, overrides: Partial<RunDeps> = {}): RunDeps & { statuses: string[] } {
  const statuses: string[] = [];
  return {
    now,
    followUp: async () => undefined,
    status: async (eventId) => {
      statuses.push(eventId);
      return "Status written now.";
    },
    mailer: { send: async () => "sent" },
    ...overrides,
    statuses
  };
}

describe("the event's zone", () => {
  it("reads the venue's country and region from the table and falls back to Toronto", () => {
    expect(eventZone({ country: "CA", region: "ON" })).toBe(TORONTO);
    expect(eventZone({ country: "CA", region: "BC" })).toBe("America/Vancouver");
    expect(eventZone({ country: "Canada", region: "NS" })).toBe("America/Halifax");
    expect(eventZone({ country: "US", region: "CA" })).toBe("America/Los_Angeles");
    expect(eventZone({ country: "United States", region: "TX" })).toBe("America/Chicago");
    expect(eventZone({ country: "US", region: "" })).toBe("America/New_York");
    expect(eventZone({ country: "GB", region: "London" })).toBe("Europe/London");
    expect(eventZone({ country: "JP", region: "" })).toBe("Asia/Tokyo");
    expect(eventZone({ country: "", region: "" })).toBe(TORONTO);
    expect(eventZone({ country: "ZZ", region: "QQ" })).toBe(TORONTO);
  });
});

describe("resolving the organizer's words in the zone", () => {
  const at = (phrase: string, zone = TORONTO) => resolveWhen(phrase, zone, NOW);

  it("resolves a weekday with a time to the coming one at that wall clock", () => {
    expect(at("Friday at 9")).toEqual({ run_at: "2026-09-04T13:00:00.000Z", every_minutes: null, local: "Fri, 2026-09-04, 09:00 EDT", zone: TORONTO });
    expect(at("on friday at 9:30pm")).toMatchObject({ run_at: "2026-09-05T01:30:00.000Z" });
    expect(at("Friday at 9", "America/Vancouver")).toMatchObject({ run_at: "2026-09-04T16:00:00.000Z", zone: "America/Vancouver" });
    // Today's weekday with a time still ahead is today; with a time gone by it is next week.
    expect(at("Wednesday at 17:00")).toMatchObject({ run_at: "2026-09-02T21:00:00.000Z" });
    expect(at("Wednesday at 9am")).toMatchObject({ run_at: "2026-09-09T13:00:00.000Z" });
  });

  it("resolves today, tomorrow, tonight, a bare time, and a relative span", () => {
    expect(at("tomorrow at 17:00")).toMatchObject({ run_at: "2026-09-03T21:00:00.000Z", every_minutes: null });
    expect(at("tomorrow morning")).toMatchObject({ run_at: "2026-09-03T13:00:00.000Z" });
    expect(at("tonight")).toMatchObject({ run_at: "2026-09-03T00:00:00.000Z" });
    expect(at("at 11")).toMatchObject({ run_at: "2026-09-02T15:00:00.000Z" });
    expect(at("9am")).toMatchObject({ run_at: "2026-09-03T13:00:00.000Z" });
    expect(at("noon")).toMatchObject({ run_at: "2026-09-02T16:00:00.000Z" });
    expect(at("in 2 hours")).toMatchObject({ run_at: "2026-09-02T16:00:00.000Z" });
    expect(at("in 15 minutes")).toMatchObject({ run_at: "2026-09-02T14:15:00.000Z" });
    expect(at("now")).toMatchObject({ run_at: NOW.toISOString() });
  });

  it("reads an ISO time as given, or as a wall clock in the zone without an offset", () => {
    expect(at("2026-09-10T09:00:00Z")).toMatchObject({ run_at: "2026-09-10T09:00:00.000Z" });
    expect(at("2026-09-10 09:00")).toMatchObject({ run_at: "2026-09-10T13:00:00.000Z" });
    expect(at("2026-09-10")).toMatchObject({ ambiguous: expect.stringContaining("Which time on 2026-09-10") });
  });

  it("turns a repeat into an interval with the first run at the next slot", () => {
    expect(at("every morning")).toMatchObject({ run_at: "2026-09-03T13:00:00.000Z", every_minutes: 1440 });
    expect(at("every day at 8")).toMatchObject({ run_at: "2026-09-03T12:00:00.000Z", every_minutes: 1440 });
    expect(at("every evening")).toMatchObject({ run_at: "2026-09-02T22:00:00.000Z", every_minutes: 1440 });
    expect(at("every Monday at 9")).toMatchObject({ run_at: "2026-09-07T13:00:00.000Z", every_minutes: 10080 });
    expect(at("every 30 minutes")).toMatchObject({ run_at: "2026-09-02T14:30:00.000Z", every_minutes: 30 });
    expect(at("every hour")).toMatchObject({ run_at: "2026-09-02T15:00:00.000Z", every_minutes: 60 });
    expect(at("daily at 7")).toMatchObject({ run_at: "2026-09-03T11:00:00.000Z", every_minutes: 1440 });
  });

  it("asks when the day has no time, the hour could be either half of the day, the time has passed, or the words do not read", () => {
    expect(at("Friday")).toMatchObject({ ambiguous: "Which time on friday?" });
    expect(at("Friday at 5")).toMatchObject({ ambiguous: "Is that 5 in the morning or the evening?" });
    expect(at("every day")).toMatchObject({ ambiguous: "Which time each day?" });
    expect(at("every week")).toMatchObject({ ambiguous: "Which time each week?" });
    expect(at("today at 8")).toMatchObject({ ambiguous: expect.stringContaining("has passed") });
    expect(at("whenever")).toMatchObject({ ambiguous: expect.stringContaining("could not read") });
    expect(at("")).toMatchObject({ ambiguous: "When should it run?" });
  });
});

describe("the schedule rows", () => {
  beforeEach(resetState);

  it("creates, lists by run time, cancels, and reports what is due", () => {
    const event = seed();
    const later = createSchedule(event.id, { action: "status", description: "status tomorrow", run_at: "2026-09-03T13:00:00Z" }, NOW);
    const soon = createSchedule(event.id, { action: "follow_up", description: "remind on Friday", run_at: "2026-09-02T14:30:00Z" }, NOW);
    expect(listSchedules(event.id).map((s) => s.id)).toEqual([soon.id, later.id]);
    expect(soon).toMatchObject({ event_id: event.id, gift_id: null, text: null, every_minutes: null, last_run_at: null, cancelled_at: null, created_at: NOW.toISOString() });
    expect(dueSchedules(event.id, NOW)).toEqual([]);
    expect(dueSchedules(event.id, new Date("2026-09-02T14:30:00Z")).map((s) => s.id)).toEqual([soon.id]);
    const cancelled = cancelSchedule(event.id, soon.id, NOW);
    expect(cancelled.cancelled_at).toBe(NOW.toISOString());
    expect(listSchedules(event.id).map((s) => s.id)).toEqual([later.id]);
    expect(listSchedules(event.id, true)).toHaveLength(2);
    expect(dueSchedules(event.id, new Date("2026-09-02T15:00:00Z"))).toEqual([]);
  });

  it("refuses a message without text, a bad time, a bad repeat, and a gift the event lacks", () => {
    const event = seed();
    expect(() => createSchedule(event.id, { action: "message", description: "tell everyone", run_at: NOW.toISOString() })).toThrow(BadRequestError);
    expect(() => createSchedule(event.id, { action: "status", description: "x", run_at: "soon" })).toThrow(BadRequestError);
    expect(() => createSchedule(event.id, { action: "status", description: "x", run_at: NOW.toISOString(), every_minutes: 0 })).toThrow(BadRequestError);
    expect(() => createSchedule(event.id, { action: "follow_up", description: "x", run_at: NOW.toISOString(), gift_id: "gift_missing" })).toThrow(NotFoundError);
    expect(() => cancelSchedule(event.id, "sch_missing")).toThrow(NotFoundError);
  });
});

describe("running a due schedule", () => {
  beforeEach(resetState);
  afterEach(() => setMailer(null));

  it("posts a status line with the schedule id, records the run, and a one-time row is no longer due", async () => {
    const event = seed();
    const row = createSchedule(event.id, { action: "status", description: "post me a status", run_at: NOW.toISOString() }, NOW);
    const d = deps(NOW);
    const posted = await runSchedule(event.id, row, d);
    expect(posted).toMatchObject({ role: "system", text: "Status written now.", schedule_id: row.id, at: NOW.toISOString() });
    expect(d.statuses).toEqual([event.id]);
    expect(listSchedules(event.id)[0].last_run_at).toBe(NOW.toISOString());
    expect(dueSchedules(event.id, new Date("2026-09-02T15:00:00Z"))).toEqual([]);
  });

  it("moves a repeat to its next future slot and leaves it live", async () => {
    const event = seed();
    const row = createSchedule(event.id, { action: "status", description: "every morning", run_at: "2026-09-02T13:00:00Z", every_minutes: 1440 }, NOW);
    await runSchedule(event.id, row, deps(NOW));
    const [next] = listSchedules(event.id);
    expect(next).toMatchObject({ run_at: "2026-09-03T13:00:00.000Z", last_run_at: NOW.toISOString(), every_minutes: 1440 });
    expect(dueSchedules(event.id, new Date("2026-09-03T12:59:00Z"))).toEqual([]);
    expect(dueSchedules(event.id, new Date("2026-09-03T13:00:00Z")).map((s) => s.id)).toEqual([row.id]);
    // A tick that arrives days late skips the missed slots and lands on the next one ahead.
    const late = new Date("2026-09-06T13:30:00Z");
    await runSchedule(event.id, listSchedules(event.id)[0], deps(late));
    expect(listSchedules(event.id)[0].run_at).toBe("2026-09-07T13:00:00.000Z");
  });

  it("sends the follow-up for the gift and reports how many attendees it reached", async () => {
    const event = seed();
    const gift = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/1", shop_domain: "shop.example", product_title: "Crewneck", variants: [{ id: "v", title: "One", price_cents: 1000, currency: "CAD", available: true, options: [] }], personalization: { fields: FIELDS }, default_variant_id: "v" });
    const name = upsertDefinition(event.id, { namespace: "organizer", key: "printed_name", label: "Printed name", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer" });
    fakeMailer();
    await requestFromAttendees(event.id, gift.id);
    const row = createSchedule(event.id, { action: "follow_up", description: "remind everyone who has not answered on Friday at 9", run_at: NOW.toISOString(), gift_id: gift.id }, NOW);
    const { followUp } = await import("./api");
    const posted = await runSchedule(event.id, row, deps(NOW, { followUp }));
    expect(posted.text).toMatch(/^Reminder sent to 3 attendees for Crewneck; 1 guest has not replied to the invitation\.$/);
    expect(posted.schedule_id).toBe(row.id);
    expect(name.id).toBeTruthy();
  });

  it("names the attendees a message is for and mails them, and posts the text when it names nobody", async () => {
    const event = seed();
    const guests = recipientsFor(event.id, "tell everyone going the doors open at 6");
    expect(guests.map((g) => g.display_name).sort()).toEqual(["Avery Chen", "Blake Rivera", "Devon Lee"]);
    expect(recipientsFor(event.id, "message everyone who has not replied").map((g) => g.display_name)).toEqual(["Casey Park"]);
    expect(recipientsFor(event.id, "send Avery Chen the parking note").map((g) => g.display_name)).toEqual(["Avery Chen"]);
    expect(recipientsFor(event.id, "post the parking note")).toEqual([]);

    const sent: MailMessage[] = [];
    const mailer = { send: async (m: MailMessage) => (sent.push(m), "sent" as const) };
    const toGoing = createSchedule(event.id, { action: "message", description: "tell everyone going the doors open at 6", text: "Doors open at 6.", run_at: NOW.toISOString() }, NOW);
    const posted = await runSchedule(event.id, toGoing, deps(NOW, { mailer }));
    expect(sent.map((m) => m.to)).toEqual(["a@b.co", "a@b.co"]);
    expect(sent[0]).toMatchObject({ subject: "A message from the organizer of Astronomy Symposium", text: expect.stringContaining("Doors open at 6.") });
    expect(sent[0].text).toContain(`/i/${event.invite_code}?guest=`);
    expect(posted.text).toBe("Message sent to 2 attendees and 1 attendee has no email address: Doors open at 6.");

    const toChat = createSchedule(event.id, { action: "message", description: "post the parking note", text: "Park on the north side.", run_at: NOW.toISOString() }, NOW);
    const line = await runSchedule(event.id, toChat, deps(new Date("2026-09-02T14:01:00Z"), { mailer }));
    expect(line).toMatchObject({ role: "system", text: "Park on the north side.", schedule_id: toChat.id });
    expect(sent).toHaveLength(2);
    expect(messagesFor(event.id).map((m) => m.schedule_id)).toEqual([toGoing.id, toChat.id]);
  });

  it("posts the failure as the line and still records the run", async () => {
    const event = seed();
    const row = createSchedule(event.id, { action: "status", description: "status", run_at: NOW.toISOString() }, NOW);
    const posted = await runSchedule(event.id, row, deps(NOW, { status: async () => Promise.reject(new Error("the model is down")) }));
    expect(posted.text).toBe('The scheduled action "status" failed: the model is down');
    expect(listSchedules(event.id)[0].last_run_at).toBe(NOW.toISOString());
  });

  it("writes the deterministic status from the snapshot counts", () => {
    const event = seed();
    expect(statusLine(event.id)).toBe("Status: 3 going, 0 maybe, 0 not going, 1 without a reply.");
  });
});
