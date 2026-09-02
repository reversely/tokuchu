import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { setDemoIdReader, setSessionReader } from "../../server/ownership";

describe("GET /demo", () => {
  beforeAll(() => {
    setSessionReader(async () => null);
    setDemoIdReader(async () => null);
  });
  afterAll(() => {
    setSessionReader(null);
    setDemoIdReader(null);
  });

  it("answers a prefetch with no body and no cookie so the real navigation mints the only demo id", async () => {
    const res = await GET(new NextRequest("http://localhost/demo", { headers: { "sec-purpose": "prefetch" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("mints the demo id and the event on a real visit", async () => {
    const res = await GET(new NextRequest("http://localhost/demo"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/events\/evt_.+\?demo=1$/);
    expect(res.headers.get("set-cookie")).toContain("tokuchu_demo=demo_");
  });
});
