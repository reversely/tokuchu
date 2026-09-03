/**
 * The isolation matrix: two accounts and two guests each own one event with a gift, a guest, and a
 * bearer token; every route under /api/events/[id] invoked by one identity against another's event
 * answers 401, 403, or 404 and never returns the other owner's data, and the event list shows only
 * the caller's rows. The store runs in memory, so every identity's events sit in one State and a
 * leak would show.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import { createEventFromBody, createGiftFromBody, submitRsvp } from "./api";
import { pgliteDatabase, setDatabase, type Database } from "./db";
import { migrate } from "./migrations";
import { createToken } from "./mcp";
import { currentCaller, setDemoIdReader, setSessionReader } from "./ownership";
import { newDemoId } from "./demo-session";
import { GET as listEvents } from "../app/api/events/route";
import * as event from "../app/api/events/[id]/route";
import * as changes from "../app/api/events/[id]/changes/route";
import * as counts from "../app/api/events/[id]/counts/route";
import * as curate from "../app/api/events/[id]/curate/route";
import * as definitions from "../app/api/events/[id]/definitions/route";
import * as approveSpecs from "../app/api/events/[id]/gifts/[giftId]/approve-specs/route";
import * as approve from "../app/api/events/[id]/gifts/[giftId]/approve/route";
import * as cart from "../app/api/events/[id]/gifts/[giftId]/cart/route";
import * as followUp from "../app/api/events/[id]/gifts/[giftId]/follow-up/route";
import * as lock from "../app/api/events/[id]/gifts/[giftId]/lock/route";
import * as manifest from "../app/api/events/[id]/gifts/[giftId]/manifest/route";
import * as overrides from "../app/api/events/[id]/gifts/[giftId]/overrides/[guestId]/route";
import * as personalization from "../app/api/events/[id]/gifts/[giftId]/personalization/route";
import * as requestFields from "../app/api/events/[id]/gifts/[giftId]/request-fields/route";
import * as gift from "../app/api/events/[id]/gifts/[giftId]/route";
import * as send from "../app/api/events/[id]/gifts/[giftId]/send/route";
import * as sync from "../app/api/events/[id]/gifts/[giftId]/sync/route";
import * as updates from "../app/api/events/[id]/gifts/[giftId]/updates/route";
import * as gifts from "../app/api/events/[id]/gifts/route";
import * as guest from "../app/api/events/[id]/guests/[guestId]/route";
import * as guestImport from "../app/api/events/[id]/guests/import/route";
import * as guests from "../app/api/events/[id]/guests/route";
import * as mcp from "../app/api/events/[id]/mcp/route";
import * as grants from "../app/api/events/[id]/grants/route";
import * as missing from "../app/api/events/[id]/missing/route";
import * as publish from "../app/api/events/[id]/publish/route";
import * as rsvpGuest from "../app/api/events/[id]/rsvp/[guestId]/route";
import * as rsvp from "../app/api/events/[id]/rsvp/route";
import * as search from "../app/api/events/[id]/search/route";
import * as summary from "../app/api/events/[id]/summary/route";
import * as tokens from "../app/api/events/[id]/tokens/route";

type Identity = { name: string; user?: string; guest?: string };
type Owned = { id: string; giftId: string; guestId: string; tokenId: string; title: string };
type Ids = { id: string; giftId: string; guestId: string };
type Handler = (request: Request, context: { params: Promise<Ids> }) => Promise<Response>;
type Route = { name: string; handler: Handler; method?: string; body?: unknown; query?: string };

const BODY = { host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const GIFT = { product_id: "gid://shopify/Product/1", shop_domain: "example.myshopify.com", product_title: "Crewneck", variants: [{ id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] }], default_variant_id: "v-m" };

const IDENTITIES: Identity[] = [
  { name: "account A", user: "user_a" },
  { name: "account B", user: "user_b" },
  { name: "guest C", guest: newDemoId() },
  { name: "guest D", guest: newDemoId() }
];

/** The organizer routes and the public ones, each called with the ids of the event under test. */
const ROUTES: Route[] = [
  { name: "GET event", handler: event.GET },
  { name: "PATCH event", handler: event.PATCH, method: "PATCH", body: { title: "Changed" } },
  { name: "GET changes", handler: changes.GET },
  { name: "GET counts", handler: counts.GET, query: "?definition=def_1" },
  { name: "POST curate", handler: curate.POST, method: "POST", body: { message: "hello" } },
  { name: "POST curate stream", handler: curate.POST, method: "POST", body: { message: "hello" }, query: "?stream=1" },
  { name: "PUT definitions", handler: definitions.PUT, method: "PUT", body: { definitions: [] } },
  { name: "POST approve-specs", handler: approveSpecs.POST, method: "POST" },
  { name: "POST approve", handler: approve.POST, method: "POST", body: {} },
  { name: "GET cart", handler: cart.GET },
  { name: "POST follow-up", handler: followUp.POST, method: "POST" },
  { name: "POST lock", handler: lock.POST, method: "POST" },
  { name: "GET manifest", handler: manifest.GET },
  { name: "PUT override", handler: overrides.PUT, method: "PUT", body: {} },
  { name: "POST personalization", handler: personalization.POST, method: "POST", body: { mappings: [] } },
  { name: "GET request-fields", handler: requestFields.GET },
  { name: "POST request-fields", handler: requestFields.POST, method: "POST" },
  { name: "GET gift", handler: gift.GET },
  { name: "PATCH gift", handler: gift.PATCH, method: "PATCH", body: {} },
  { name: "DELETE gift", handler: gift.DELETE, method: "DELETE" },
  { name: "POST send", handler: send.POST, method: "POST", body: {} },
  { name: "POST sync", handler: sync.POST, method: "POST" },
  { name: "GET updates", handler: updates.GET },
  { name: "POST updates", handler: updates.POST, method: "POST", body: { kind: "note", text: "hi" } },
  { name: "GET gifts", handler: gifts.GET },
  { name: "POST gifts", handler: gifts.POST, method: "POST", body: GIFT },
  { name: "GET grants", handler: grants.GET },
  { name: "POST grants", handler: grants.POST, method: "POST", body: { procurement_id: "gift_1", grantee_type: "vendor", grantee_id: "store", permissions: ["manifest:read"] } },
  { name: "GET guest", handler: guest.GET },
  { name: "POST guests import", handler: guestImport.POST, method: "POST", body: { lines: ["Eve"] } },
  { name: "GET guests", handler: guests.GET },
  { name: "GET missing", handler: missing.GET, query: "?definition=def_1" },
  { name: "POST publish", handler: publish.POST, method: "POST" },
  { name: "POST search", handler: search.POST, method: "POST", body: { sentence: "shirts" } },
  { name: "GET summary", handler: summary.GET },
  { name: "POST tokens", handler: tokens.POST, method: "POST", body: { holder: "x" } },
  { name: "GET tokens", handler: tokens.GET }
];

function call(route: Route, ids: Owned): Promise<Response> {
  const init: RequestInit = { method: route.method ?? "GET" };
  if (route.body !== undefined) init.body = JSON.stringify(route.body);
  const request = new Request(`http://localhost/api/events/${ids.id}${route.query ?? ""}`, init);
  return route.handler(request, { params: Promise.resolve({ id: ids.id, giftId: ids.giftId, guestId: ids.guestId }) });
}

function runAs(identity: Identity): void {
  setSessionReader(async () => identity.user ?? null);
  setDemoIdReader(async () => identity.guest ?? null);
}

/** One event per identity with a gift, an attendee, and a bearer token, so every route has a row to reach. */
function seed(identity: Identity): Owned {
  const ownerId = identity.user ?? identity.guest!;
  const title = `${identity.name}'s event`;
  const created = publishEvent(createEventFromBody({ ...BODY, title }, ownerId, !!identity.guest).id);
  const giftId = createGiftFromBody(created.id, GIFT).id;
  const [guestId] = submitRsvp(created.id, { guests: [{ display_name: `${identity.name} attendee`, status: "going" }] }).guest_ids;
  const tokenId = createToken(created.id, { holder: identity.name, callable_tools: ["list_guests"] }).id;
  return { id: created.id, giftId, guestId, tokenId, title };
}

describe("the isolation matrix", () => {
  const owned = new Map<string, Owned>();

  beforeAll(() => {
    resetState();
    process.env.LLM_ENABLED = "1";
    for (const identity of IDENTITIES) owned.set(identity.name, seed(identity));
  });

  afterAll(() => {
    delete process.env.LLM_ENABLED;
    setSessionReader(null);
    setDemoIdReader(null);
  });

  for (const caller of IDENTITIES) {
    for (const target of IDENTITIES.filter((other) => other !== caller)) {
      it(`${caller.name} gets 401, 403, or 404 on every route of ${target.name}'s event`, async () => {
        runAs(caller);
        const ids = owned.get(target.name)!;
        for (const route of ROUTES) {
          const response = await call(route, ids);
          expect([401, 403, 404], `${route.name} answered ${response.status}`).toContain(response.status);
          expect(await response.text()).not.toContain(ids.title);
        }
      });
    }

    it(`${caller.name} opens its own event and lists only its own rows`, async () => {
      runAs(caller);
      const ids = owned.get(caller.name)!;
      const snapshot = await call({ name: "GET event", handler: event.GET }, ids);
      expect(snapshot.status).toBe(200);
      expect(((await snapshot.json()) as { event: { owner_id: string; title: string } }).event).toMatchObject({ owner_id: caller.user ?? caller.guest, title: ids.title });
      const listed = (await (await listEvents()).json()) as { events: { id: string }[] };
      expect(listed.events.map((e) => e.id)).toEqual([ids.id]);
    });
  }

  it("answers a request with no caller with 401 on every organizer route", async () => {
    setSessionReader(async () => null);
    setDemoIdReader(async () => null);
    setDatabase(await pgliteDatabase());
    try {
      expect(await currentCaller()).toBeNull();
      const ids = owned.get("account A")!;
      for (const route of ROUTES) {
        const response = await call(route, ids);
        expect([401, 404], `${route.name} answered ${response.status}`).toContain(response.status);
      }
    } finally {
      setDatabase(null);
    }
  });

  it("scopes a bearer token to its own event and answers another event's token as no token", async () => {
    const mine = owned.get("account A")!;
    const theirs = owned.get("account B")!;
    const rpc = (eventId: string, tokenId: string) =>
      mcp.POST(new Request(`http://localhost/api/events/${eventId}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokenId}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_guests", arguments: {} } }) }), { params: Promise.resolve({ id: eventId }) });
    const own = (await (await rpc(mine.id, mine.tokenId)).json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(own.result.isError).toBeFalsy();
    expect(own.result.content[0].text).toContain("account A attendee");
    const crossed = (await (await rpc(theirs.id, mine.tokenId)).json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(crossed.result.isError).toBe(true);
    expect(crossed.result.content[0].text).not.toContain("account B attendee");
  });

  it("answers the public RSVP routes only for the guest on that event", async () => {
    setSessionReader(async () => null);
    setDemoIdReader(async () => null);
    const mine = owned.get("account A")!;
    const theirs = owned.get("account B")!;
    const crossed = await rsvpGuest.GET(new Request(`http://localhost/api/events/${mine.id}/rsvp/${theirs.guestId}`), { params: Promise.resolve({ id: mine.id, guestId: theirs.guestId }) });
    expect(crossed.status).toBe(404);
    const own = await rsvpGuest.GET(new Request(`http://localhost/api/events/${mine.id}/rsvp/${mine.guestId}`), { params: Promise.resolve({ id: mine.id, guestId: mine.guestId }) });
    expect(own.status).toBe(200);
    expect(await own.text()).not.toContain("owner_id");
    const reply = await rsvp.POST(new Request(`http://localhost/api/events/${mine.id}/rsvp`, { method: "POST", body: JSON.stringify({ guests: [{ display_name: "Late reply" }] }) }), { params: Promise.resolve({ id: mine.id }) });
    expect(reply.status).toBe(201);
    expect(await reply.text()).not.toContain("owner_id");
  });
});

describe("the local organizer", () => {
  let db: Database;

  beforeAll(async () => {
    db = await pgliteDatabase();
    await migrate(db);
  }, 30_000);

  afterEach(() => {
    setDatabase(null);
    setSessionReader(null);
    setDemoIdReader(null);
  });

  afterAll(() => db.close());

  it("never appears once a database is set", async () => {
    setSessionReader(async () => null);
    setDemoIdReader(async () => null);
    setDatabase(db);
    expect(await currentCaller()).toBeNull();
    setDatabase(null);
    expect(await currentCaller()).toMatchObject({ is_local: true });
  });
});
