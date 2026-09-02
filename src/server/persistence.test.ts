import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishEvent, state } from "../domain/store";
import { createEventFromBody, importGuests, inviteView, snapshot } from "./api";
import { pgliteDatabase, setDatabase, type Database } from "./db";
import { NotFoundError } from "./errors";
import { migrate } from "./migrations";
import { afterCommit, createPersistedEvent, listOwnedEvents, withPersistedEvent, withPersistedEventByInviteCode } from "./persistence";

const BODY = { title: "Persisted event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

let db: Database;

beforeAll(async () => {
  db = await pgliteDatabase();
  await migrate(db);
  setDatabase(db);
}, 30_000);

afterAll(async () => {
  setDatabase(null);
  await db.close();
});

const create = () => createPersistedEvent(() => createEventFromBody(BODY));
const rowData = async (id: string) => JSON.stringify((await db.query("select data from events where id = $1", [id]))[0]?.data);

describe("migrate", () => {
  it("creates the events table once and records the name", async () => {
    expect(await migrate(db)).toEqual([]);
    expect((await db.query("select name from schema_migrations")).map((r) => r.name)).toEqual(["001_events", "002_users", "003_accounts", "004_sessions", "005_verification_token"]);
    const columns = await db.query("select column_name from information_schema.columns where table_name = 'events' order by ordinal_position");
    expect(columns.map((c) => c.column_name)).toEqual(["id", "owner_id", "invite_code", "data", "updated_at"]);
  });

  it("keeps invite codes unique", async () => {
    await db.query("insert into events (id, invite_code, data) values ('evt_dup_a', 'SAMECODE', '{}'::jsonb)");
    await expect(db.query("insert into events (id, invite_code, data) values ('evt_dup_b', 'SAMECODE', '{}'::jsonb)")).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("withPersistedEvent", () => {
  it("round-trips an event through create, read, mutate, and reload", async () => {
    const event = await create();
    expect((await withPersistedEvent(event.id, () => snapshot(event.id))).event.title).toBe("Persisted event");
    const added = await withPersistedEvent(event.id, () => importGuests(event.id, { lines: ["Ana <ana@example.com>", "Ben"] }));
    expect(added.added).toBe(2);
    const reloaded = await withPersistedEvent(event.id, () => snapshot(event.id));
    expect(reloaded.guests.map((g) => g.display_name)).toEqual(["Ana", "Ben"]);
    expect(JSON.parse(await rowData(event.id)).guests).toHaveLength(2);
  });

  it("scopes each request to its own event", async () => {
    const [a, b] = await Promise.all([create(), create()]);
    await withPersistedEvent(a.id, () => importGuests(a.id, { lines: ["Only on A"] }));
    await withPersistedEvent(b.id, () => {
      expect([...state().events.keys()]).toEqual([b.id]);
      expect(state().guests.size).toBe(0);
    });
    expect((await withPersistedEvent(a.id, () => snapshot(a.id))).guests).toHaveLength(1);
  });

  it("writes nothing when the handler throws", async () => {
    const event = await create();
    const before = await rowData(event.id);
    await expect(withPersistedEvent(event.id, () => { importGuests(event.id, { lines: ["Lost"] }); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await rowData(event.id)).toBe(before);
  });

  it("answers a missing row with NotFoundError", async () => {
    await expect(withPersistedEvent("evt_missing", () => 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(withPersistedEventByInviteCode("NOCODE", () => 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("loads a published event by its invite code", async () => {
    const event = await create();
    const published = await withPersistedEvent(event.id, () => publishEvent(event.id));
    const code = published.invite_code as string;
    expect((await db.query("select invite_code from events where id = $1", [event.id]))[0].invite_code).toBe(code);
    expect((await withPersistedEventByInviteCode(code.toLowerCase(), () => inviteView(code))).event.id).toBe(event.id);
  });

  it("settles afterCommit once the row is written", async () => {
    const event = await create();
    let committed: Promise<void> | undefined;
    await withPersistedEvent(event.id, () => { committed = afterCommit(); importGuests(event.id, { lines: ["Late"] }); });
    await committed;
    expect(JSON.parse(await rowData(event.id)).guests).toHaveLength(1);
  });
});

describe("ownership", () => {
  it("writes the owner to the row and lists an organizer's events by it", async () => {
    const mine = await createPersistedEvent(() => createEventFromBody({ ...BODY, title: "Mine" }, "user_owner"));
    await createPersistedEvent(() => createEventFromBody({ ...BODY, title: "Theirs" }, "user_other"));
    expect((await db.query("select owner_id from events where id = $1", [mine.id]))[0].owner_id).toBe("user_owner");
    const listed = await listOwnedEvents("user_owner");
    expect(listed.map((e) => e.id)).toEqual([mine.id]);
    expect(listed[0]).toMatchObject({ title: "Mine", status: "draft", invite_code: null });
    expect(Date.parse(listed[0].updated_at)).not.toBeNaN();
    expect((await withPersistedEvent(mine.id, () => snapshot(mine.id))).event.owner_id).toBe("user_owner");
  });
});

describe("event ids", () => {
  it("mints a uuid-based id rather than the per-document counter", async () => {
    const [a, b] = await Promise.all([create(), create()]);
    expect(a.id).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.definition_ids).toEqual([]);
  });
});
