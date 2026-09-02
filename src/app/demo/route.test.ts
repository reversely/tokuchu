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

  it("mints the demo id and the event on a real visit and repeats the signed value as the URL token", async () => {
    const res = await GET(new NextRequest("http://localhost/demo"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toMatch(/^\/events\/evt_.+$/);
    expect(location.searchParams.get("demo")).toBe("1");
    const token = location.searchParams.get("t")!;
    expect(token).toMatch(/^demo_[A-Za-z0-9_-]{16}\.[0-9a-f]{64}$/);
    expect(res.headers.get("set-cookie")).toContain(`tokuchu_demo=${token}`);
  });

  it("resumes the demo the URL token names when the browser sends no cookie", async () => {
    const first = new URL((await GET(new NextRequest("http://localhost/demo"))).headers.get("location")!);
    const again = new URL((await GET(new NextRequest(`http://localhost/demo?t=${first.searchParams.get("t")}`))).headers.get("location")!);
    expect(again.pathname).toBe(first.pathname);
    expect(again.searchParams.get("t")).toBe(first.searchParams.get("t"));
  });

  it("mints a fresh demo for a URL token whose signature does not match", async () => {
    const first = new URL((await GET(new NextRequest("http://localhost/demo"))).headers.get("location")!);
    const forged = `${first.searchParams.get("t")!.split(".")[0]}.${"0".repeat(64)}`;
    const again = new URL((await GET(new NextRequest(`http://localhost/demo?t=${forged}`))).headers.get("location")!);
    expect(again.pathname).not.toBe(first.pathname);
  });
});
