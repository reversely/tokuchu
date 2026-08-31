/**
 * Client for the Shopify GraphQL Admin API (issue #1). It mints a 24 hour access token from the
 * app's client id and secret through the client credentials grant, caches it in the process, and
 * refreshes it before expiry, so a caller runs a query without handling auth. The app and the store
 * must belong to the same Shopify organization for the grant to work.
 *
 * Env: SHOPIFY_STORE_DOMAIN (e.g. springbuilt.myshopify.com), SHOPIFY_API_KEY (client id),
 * SHOPIFY_API_SECRET (client secret, shpss_), SHOPIFY_ADMIN_API_VERSION (default 2025-01).
 */

export class ShopifyAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyAdminError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ShopifyAdminError(`Set ${name} in the environment before calling the Shopify Admin API.`);
  return value;
}

function apiVersion(): string {
  return process.env.SHOPIFY_ADMIN_API_VERSION || "2025-01";
}

type Cached = { token: string; expiresAt: number };
let cached: Cached | null = null;
/** Refresh this many milliseconds before the token's stated expiry so a call never races it. */
const REFRESH_MARGIN_MS = 60_000;

/** Drops the cached token so the next call mints a fresh one; used by the 401 retry and by tests. */
export function resetAdminToken(): void {
  cached = null;
}

async function mintToken(fetchImpl: typeof fetch): Promise<Cached> {
  const domain = requireEnv("SHOPIFY_STORE_DOMAIN");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: requireEnv("SHOPIFY_API_KEY"),
    client_secret: requireEnv("SHOPIFY_API_SECRET")
  });
  const res = await fetchImpl(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const text = await res.text();
  let parsed: { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new ShopifyAdminError(`The token endpoint answered ${res.status} with a non-JSON body.`);
  }
  if (!parsed.access_token) {
    const reason = parsed.error_description || parsed.error || `status ${res.status}`;
    throw new ShopifyAdminError(`The client credentials grant returned no token: ${reason}.`);
  }
  const ttlMs = (parsed.expires_in ?? 86_399) * 1000;
  return { token: parsed.access_token, expiresAt: Date.now() + ttlMs - REFRESH_MARGIN_MS };
}

/** The cached access token, minting or refreshing it when the cache is empty or within the margin of expiry. */
export async function adminToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  cached = await mintToken(fetchImpl);
  return cached.token;
}

/** Runs one GraphQL Admin API query and returns its `data`. A 401 refreshes the token once and retries. */
export async function adminGraphql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const domain = requireEnv("SHOPIFY_STORE_DOMAIN");
  const url = `https://${domain}/admin/api/${apiVersion()}/graphql.json`;

  const call = async (token: string) =>
    fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: opts.signal
    });

  let res = await call(await adminToken(fetchImpl));
  if (res.status === 401) {
    resetAdminToken();
    res = await call(await adminToken(fetchImpl));
  }
  const text = await res.text();
  let parsed: { data?: T; errors?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new ShopifyAdminError(`The Admin API answered ${res.status} with a non-JSON body.`);
  }
  if (parsed.errors) throw new ShopifyAdminError(`The Admin API returned errors: ${JSON.stringify(parsed.errors).slice(0, 500)}`);
  if (parsed.data === undefined) throw new ShopifyAdminError(`The Admin API answered ${res.status} with no data.`);
  return parsed.data;
}

/** The store's name, currency, primary domain, and plan, as a connection check. */
export async function getShop(opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<{
  name: string;
  currencyCode: string;
  primaryDomain: { url: string };
  plan: { displayName: string };
}> {
  const data = await adminGraphql<{ shop: { name: string; currencyCode: string; primaryDomain: { url: string }; plan: { displayName: string } } }>(
    "{ shop { name currencyCode primaryDomain { url } plan { displayName } } }",
    undefined,
    opts
  );
  return data.shop;
}
