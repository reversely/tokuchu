/** The tour resumes where the event's state leaves off and backs up to the step that introduces the next action. */
import { describe, expect, it } from "vitest";
import { startIndex, STEPS, type TourState } from "./steps";

const going = (n: number) => Array.from({ length: n }, () => ({ status: "going" }));
const gift = (over: Partial<TourState["gifts"][number]> = {}) => [{ locked_at: null, checkout_url: null, ...over }];
const id = (i: number) => STEPS[i].id;

describe("startIndex", () => {
  it("opens on the published step for a fresh event", () => {
    expect(id(startIndex({ guests: [], requests: [], gifts: [] }))).toBe("published");
  });
  it("opens on the requirements once the gift exists", () => {
    expect(id(startIndex({ guests: [], requests: [], gifts: gift() }))).toBe("requirements");
  });
  it("opens on the answers once the request went out", () => {
    expect(id(startIndex({ guests: [], requests: [{ complete: false }], gifts: gift() }))).toBe("answers");
  });
  it("opens on approval once three attendees answered", () => {
    expect(id(startIndex({ guests: going(3), requests: [{ complete: true }, { complete: true }, { complete: true }], gifts: gift() }))).toBe("approve");
  });
  it("opens on the cart wait after approval and on the checkout once the link exists", () => {
    const answered = { guests: going(3), requests: [{ complete: true }] };
    expect(id(startIndex({ ...answered, gifts: gift({ locked_at: "2026-09-02T00:00:00Z" }) }))).toBe("cart");
    expect(id(startIndex({ ...answered, gifts: gift({ locked_at: "2026-09-02T00:00:00Z", checkout_url: "https://store/cart/c/1" }) }))).toBe("checkout");
  });
});
