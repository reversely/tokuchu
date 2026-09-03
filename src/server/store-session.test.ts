/** The store's signed link (#47): a valid value names its session, and an altered or outdated one names nothing. */
import { describe, expect, it } from "vitest";
import type { AccessGrant } from "../domain/types";
import { STORE_LINK_TTL_HOURS, storeLinkPath, storeLinkToken, storeSessionFrom } from "./store-session";

const SECRET = "test-secret"; // pragma: allowlist secret
const session = { event_id: "evt_1", grant_id: "grant_1", expires_at: Date.parse("2030-01-01T00:00:00Z") };
const grant: AccessGrant = { id: "grant_1", event_id: "evt_1", procurement_id: "gift_1", grantee_type: "vendor", grantee_id: "store", permissions: ["manifest:read"], created_by: "organizer", created_at: "2029-01-01T00:00:00Z", expires_at: null, revoked_at: null };

describe("the store link token", () => {
  it("round-trips a session and refuses an altered or outdated value", () => {
    const token = storeLinkToken(session, SECRET);
    expect(storeSessionFrom(token, SECRET, Date.parse("2029-06-01T00:00:00Z"))).toEqual(session);
    expect(storeSessionFrom(token, SECRET, session.expires_at)).toBeNull();
    expect(storeSessionFrom(token, "other-secret")).toBeNull();
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, grant_id: "grant_2" })).toString("base64url");
    expect(storeSessionFrom(`${forged}.${signature}`, SECRET)).toBeNull();
    expect(storeSessionFrom(payload, SECRET)).toBeNull();
    expect(storeSessionFrom("", SECRET)).toBeNull();
    expect(storeSessionFrom(null, SECRET)).toBeNull();
  });

  it("gives a link the grant's expiry when it comes before the link's fixed life", () => {
    const now = Date.parse("2029-01-01T00:00:00Z");
    const open = storeLinkPath(grant, now);
    expect(open.startsWith("/s/")).toBe(true);
    expect(storeSessionFrom(open.slice(3), undefined, now)?.expires_at).toBe(now + STORE_LINK_TTL_HOURS * 60 * 60 * 1000);
    const soon = storeLinkPath({ ...grant, expires_at: "2029-01-02T00:00:00Z" }, now);
    expect(storeSessionFrom(soon.slice(3), undefined, now)).toEqual({ event_id: "evt_1", grant_id: "grant_1", expires_at: Date.parse("2029-01-02T00:00:00Z") });
  });
});
