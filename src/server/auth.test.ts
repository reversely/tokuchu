import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PostgresAdapter from "@auth/pg-adapter";
import { adapterPool } from "./auth-store";
import { allowOrganizer, organizerEmails } from "./organizers";
import { pgliteDatabase, type Database } from "./db";
import { migrate } from "./migrations";

let db: Database;

beforeAll(async () => {
  db = await pgliteDatabase();
  await migrate(db);
}, 30_000);

afterAll(() => db.close());

describe("migrate", () => {
  it("creates the four tables the pg adapter queries", async () => {
    const tables = await db.query("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
    expect(tables.map((t) => t.table_name)).toEqual(["accounts", "events", "schema_migrations", "sessions", "users", "verification_token"]);
  });
});

describe("the pg adapter over the events database", () => {
  it("creates a user with a text id and finds it by email", async () => {
    const adapter = PostgresAdapter(adapterPool(async () => db));
    const user = await adapter.createUser!({ id: "", email: "one@example.com", emailVerified: null });
    expect(typeof user.id).toBe("string");
    expect(user.id).not.toBe("");
    expect((await adapter.getUserByEmail!("one@example.com"))?.id).toBe(user.id);
    expect(await adapter.getUserByEmail!("nobody@example.com")).toBeNull();
  });

  it("stores a verification token and uses it once", async () => {
    const adapter = PostgresAdapter(adapterPool(async () => db));
    const expires = new Date(Date.now() + 60_000);
    await adapter.createVerificationToken!({ identifier: "two@example.com", token: "tok", expires });
    expect((await adapter.useVerificationToken!({ identifier: "two@example.com", token: "tok" }))?.identifier).toBe("two@example.com");
    expect(await adapter.useVerificationToken!({ identifier: "two@example.com", token: "tok" })).toBeNull();
  });
});

describe("allowOrganizer", () => {
  const allowed = organizerEmails(" Host@Example.com, second@example.com ,");

  it("parses the list lowercased and trimmed", () => {
    expect([...allowed]).toEqual(["host@example.com", "second@example.com"]);
  });

  it("allows a listed address regardless of case", () => {
    expect(allowOrganizer({ user: { email: "host@example.com" } }, allowed)).toBe(true);
    expect(allowOrganizer({ user: { email: "HOST@EXAMPLE.COM" } }, allowed)).toBe(true);
  });

  it("denies an unlisted or missing address", () => {
    expect(allowOrganizer({ user: { email: "stranger@example.com" } }, allowed)).toBe(false);
    expect(allowOrganizer({ user: { email: null } }, allowed)).toBe(false);
    expect(allowOrganizer({ user: { email: "host@example.com" } }, organizerEmails(""))).toBe(false);
  });
});
