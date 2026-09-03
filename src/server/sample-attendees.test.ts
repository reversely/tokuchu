import { beforeEach, describe, expect, it } from "vitest";
import { resetState } from "../domain/store";
import { createEventFromBody, snapshot } from "./api";
import { loadSampleAttendees, SAMPLE_ATTENDEES } from "./sample-attendees";

describe("load_sample_attendees", () => {
  beforeEach(() => resetState());

  it("adds ten going attendees with emails once and returns each one's offline details", () => {
    const event = createEventFromBody({ title: "Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V", country: "CA" } });
    const first = loadSampleAttendees(event.id);
    expect(first.added).toBe(10);
    expect(first.attendees.map((a) => a.display_name)).toEqual(SAMPLE_ATTENDEES.map((a) => a.display_name));
    expect(first.attendees.filter((a) => a.location === null)).toHaveLength(3);
    const snap = snapshot(event.id);
    expect(snap.guests).toHaveLength(10);
    expect(snap.guests.every((g) => g.status === "going")).toBe(true);
    const again = loadSampleAttendees(event.id);
    expect(again).toMatchObject({ added: 0, skipped: 10 });
    expect(snapshot(event.id).guests).toHaveLength(10);
  });
});
