import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminGraphql, adminToken, getShop, resetAdminToken, ShopifyAdminError } from "./shopify-admin";

/** A fetch double that returns queued responses and records the requests it saw. */
function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { status: r.status ?? 200, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

const tokenBody = (token: string, expires = 86_399) => ({ access_token: token, scope: "write_orders", expires_in: expires });

const ENV_KEYS = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_ADMIN_API_VERSION"] as const;

describe("shopify admin client", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    // Snapshot any real values (a sourced .env) so the fakes below never leak into the live test.
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.SHOPIFY_STORE_DOMAIN = "example.myshopify.com";
    process.env.SHOPIFY_API_KEY = "key"; // pragma: allowlist secret
    process.env.SHOPIFY_API_SECRET = "secret"; // pragma: allowlist secret
    process.env.SHOPIFY_ADMIN_API_VERSION = "2025-01";
    resetAdminToken();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAdminToken();
  });

  it("mints a token once and caches it across calls", async () => {
    const f = fakeFetch([{ body: tokenBody("shpat_a") }]);
    expect(await adminToken(f)).toBe("shpat_a");
    expect(await adminToken(f)).toBe("shpat_a");
    expect(f.calls.filter((c) => c.url.includes("/admin/oauth/access_token"))).toHaveLength(1);
  });

  it("refreshes the token once its expiry passes", async () => {
    const f = fakeFetch([{ body: tokenBody("shpat_a", 30) }, { body: tokenBody("shpat_b") }]);
    // expires_in 30s minus the 60s margin puts expiry in the past, so the next call re-mints.
    expect(await adminToken(f)).toBe("shpat_a");
    expect(await adminToken(f)).toBe("shpat_b");
  });

  it("runs a query and returns its data with the token in the header", async () => {
    const f = fakeFetch([{ body: tokenBody("shpat_a") }, { body: { data: { shop: { name: "Store" } } } }]);
    const data = await adminGraphql<{ shop: { name: string } }>("{ shop { name } }", undefined, { fetchImpl: f });
    expect(data.shop.name).toBe("Store");
    const gql = f.calls.find((c) => c.url.includes("/graphql.json"))!;
    expect((gql.init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_a");
  });

  it("refreshes the token and retries once on a 401", async () => {
    const f = fakeFetch([
      { body: tokenBody("shpat_stale") },
      { status: 401, body: { errors: "unauthorized" } },
      { body: tokenBody("shpat_fresh") },
      { body: { data: { shop: { name: "Store" } } } }
    ]);
    const data = await adminGraphql<{ shop: { name: string } }>("{ shop { name } }", undefined, { fetchImpl: f });
    expect(data.shop.name).toBe("Store");
    expect(f.calls.filter((c) => c.url.includes("/admin/oauth/access_token"))).toHaveLength(2);
  });

  it("throws when the query returns GraphQL errors", async () => {
    const f = fakeFetch([{ body: tokenBody("shpat_a") }, { body: { errors: [{ message: "bad field" }] } }]);
    await expect(adminGraphql("{ nope }", undefined, { fetchImpl: f })).rejects.toBeInstanceOf(ShopifyAdminError);
  });

  it("throws a named error when the grant returns no token", async () => {
    const f = fakeFetch([{ status: 401, body: { error: "invalid_client", error_description: "wrong secret" } }]);
    await expect(adminToken(f)).rejects.toThrow(/wrong secret/);
  });

  it("throws when a required env var is missing", async () => {
    delete process.env.SHOPIFY_API_SECRET;
    await expect(adminToken(fakeFetch([{ body: tokenBody("x") }]))).rejects.toThrow(/SHOPIFY_API_SECRET/);
  });
});

// A real read against the store, gated so the normal suite stays offline.
describe.runIf(process.env.LIVE_SHOPIFY_ADMIN === "1")("shopify admin live", () => {
  it("reads the shop through the client credentials grant", async () => {
    resetAdminToken();
    const shop = await getShop();
    expect(shop.name).toBeTruthy();
    expect(shop.primaryDomain.url).toContain("myshopify.com");
  }, 30_000);
});
