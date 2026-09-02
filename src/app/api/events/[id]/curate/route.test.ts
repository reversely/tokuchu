/**
 * The curate route behind LLM_ENABLED. The mock factory below runs only when some module first
 * imports `@openai/agents`, so its counter records whether the SDK entered the module graph.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetState } from "../../../../../domain/store";
import { llmEnabled } from "../../../../../server/flags";
import { setDemoIdReader, setSessionReader } from "../../../../../server/ownership";
import { POST } from "./route";

const sdkLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@openai/agents", async (importOriginal) => {
  sdkLoads.count += 1;
  return importOriginal();
});

/** The route runs with no session and no database, so the local organizer is the caller. */
beforeAll(() => {
  setSessionReader(async () => null);
  setDemoIdReader(async () => null);
});
afterAll(() => {
  setSessionReader(null);
  setDemoIdReader(null);
});

const before = process.env.LLM_ENABLED;
afterEach(() => {
  if (before === undefined) delete process.env.LLM_ENABLED;
  else process.env.LLM_ENABLED = before;
  resetState();
});

function curate(id: string) {
  const request = new Request(`http://localhost/api/events/${id}/curate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "A sweatshirt with each guest's name" }) });
  return POST(request, { params: Promise.resolve({ id }) });
}

describe("llmEnabled", () => {
  it("is on only for 1 or true", () => {
    expect(llmEnabled("1")).toBe(true);
    expect(llmEnabled("true")).toBe(true);
    for (const value of [undefined, "", "0", "false", "yes", "TRUE"]) expect(llmEnabled(value)).toBe(false);
  });
});

describe("POST /api/events/[id]/curate", () => {
  it("answers 501 with the flag unset and never loads the agent SDK", async () => {
    delete process.env.LLM_ENABLED;
    const res = await curate("evt_missing");
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "The curation agent is switched off" });
    expect(sdkLoads.count).toBe(0);
  });

  it("passes the gate with the flag on and reaches the event lookup", async () => {
    process.env.LLM_ENABLED = "1";
    const res = await curate("evt_missing");
    expect(res.status).toBe(404);
  });
});
