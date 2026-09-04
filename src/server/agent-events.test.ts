import { beforeEach, describe, expect, it } from "vitest";
import { resetState } from "../domain/store";
import { createEventForAgent } from "./agent-events";
import { snapshot } from "./api";

describe("create_event for an agent", () => {
  beforeEach(() => resetState());

  it("creates a published temporary guest event, preserves its wall-clock offset, and names the pages with the token", () => {
    const created = createEventForAgent(
      { title: "Eastern Canada Astronomy Symposium", starts_at: "2027-03-15T09:00:00-04:00", venue: { name: "Ontario Science Centre", city: "Toronto", region: "ON", country: "CA" }, guests: ["Avery Chen <avery@example.com>", "Blake Rivera", "Avery Chen"] },
      "demo_abc",
      false,
      "https://tokuchu.test"
    );
    expect(created).toMatchObject({ owner: "guest", guests_added: 2 });
    expect(created.url).toMatch(/^https:\/\/tokuchu\.test\/events\/evt_.*\?t=demo_abc\./);
    expect(created.invite_url).toMatch(/^https:\/\/tokuchu\.test\/i\/[A-Z0-9]+$/);
    const snap = snapshot(created.event_id);
    expect(snap.event).toMatchObject({ status: "published", demo: false, starts_at: "2027-03-15T09:00:00-04:00", venue: { name: "Ontario Science Centre" } });
    expect(snap.guests.map((g) => g.display_name)).toEqual(["Avery Chen", "Blake Rivera"]);
  });

  it("names the field a bad body misses", () => {
    expect(() => createEventForAgent({ title: "" }, "u1", true, "https://tokuchu.test")).toThrow(/title|starts_at|venue/);
  });
});
