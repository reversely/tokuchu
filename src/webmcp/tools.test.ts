import { describe, expect, it } from "vitest";
import type { AttributeDefinition } from "../domain/types";
import { buildRequest, rsvpAnswers, rsvpInputSchema, TOOLS, toolsSchemaJson } from "./tools";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe("the tool definitions", () => {
  it("describe every property, declare additionalProperties false, and name a scope", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const p of Object.values(t.inputSchema.properties)) expect(p.description.length).toBeGreaterThan(0);
      expect(t.scopes.length).toBeGreaterThan(0);
    }
    expect(toolsSchemaJson().map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });
  it("builds a GET with the filter and fields as query parameters", () => {
    const { url, init } = buildRequest(tool("list_guests"), "evt_1", { filter: "status:eq:going", fields: ["def_1", "def_2"] });
    expect(url).toBe("/api/events/evt_1/guests?filter=status%3Aeq%3Agoing&fields=def_1%2Cdef_2");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
  it("substitutes path arguments and builds a JSON body for a write", () => {
    const { url, init } = buildRequest(tool("post_update"), "evt_1", { gift_id: "gift_9", kind: "confirmed", text: "Confirmed." });
    expect(url).toBe("/api/events/evt_1/gifts/gift_9/updates");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "confirmed", text: "Confirmed.", expected_date: null, reference: null, guest_id: null });
  });
  it("maps the request tools onto the request-fields and follow-up routes", () => {
    expect(buildRequest(tool("get_requirements"), "evt_1", { gift_id: "gift_9" })).toMatchObject({ url: "/api/events/evt_1/gifts/gift_9/request-fields", init: { method: "GET" } });
    expect(buildRequest(tool("request_from_attendees"), "evt_1", { gift_id: "gift_9" })).toMatchObject({ url: "/api/events/evt_1/gifts/gift_9/request-fields", init: { method: "POST" } });
    expect(buildRequest(tool("follow_up"), "evt_1", { gift_id: "gift_9" })).toMatchObject({ url: "/api/events/evt_1/gifts/gift_9/follow-up", init: { method: "POST" } });
  });
  it("keeps the money-spending tools away from vendor scope", () => {
    for (const name of ["set_gift_plan", "set_personalization_mapping", "send_to_vendor", "approve", "approve_specs", "list_guests", "get_guest", "list_missing", "search_gifts", "get_requirements", "request_from_attendees", "follow_up"]) expect(tool(name).scopes).toEqual(["organizer"]);
    for (const name of ["get_manifest", "get_changes", "post_update", "get_updates", "count_by", "get_summary"]) expect(tool(name).scopes).toContain("vendor");
    expect(tool("submit_rsvp").scopes).toEqual(["attendee"]);
  });
});

const question = (over: Partial<AttributeDefinition>): AttributeDefinition => ({ id: "def_x", event_id: "evt_1", namespace: "organizer", key: "x", label: "X", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer", ...over });
const asked = [
  question({ id: "def_1", key: "name_on_map", label: "Name on the map", constraints: { max_length: 20 } }),
  question({ id: "def_2", key: "variant_size", label: "Size", value_type: "enum", constraints: { options: [{ value: "s", label: "S" }, { value: "m", label: "M" }] } }),
  question({ id: "def_3", key: "map_time", label: "Time", constraints: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, required_rule: "never" })
];

describe("the submit_rsvp schema", () => {
  it("carries each question's constraints as JSON Schema and requires the ones needed when going", () => {
    const schema = rsvpInputSchema(asked, ["going", "cant_go"]);
    expect(schema).toEqual({
      type: "object",
      properties: {
        display_name: { type: "string", description: expect.any(String) },
        status: { type: "string", description: expect.any(String), enum: ["going", "cant_go"] },
        guest_id: { type: "string", description: expect.any(String) },
        name_on_map: { type: "string", description: "Name on the map; required when going", maxLength: 20 },
        variant_size: { type: "string", description: "Size; required when going", enum: ["s", "m"] }
      },
      required: ["display_name", "status", "name_on_map", "variant_size"],
      additionalProperties: false
    });
  });
  it("gives a date its format, a patterned text its pattern, and skips a choice with no options", () => {
    const defs = [question({ id: "def_3", key: "map_time", label: "Time", constraints: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } }), question({ id: "def_4", key: "map_date", label: "Date", value_type: "date" }), question({ id: "def_5", key: "empty", value_type: "enum", constraints: { options: [] } }), question({ id: "def_6", key: "party_note", scope: "party" })];
    const { properties, required } = rsvpInputSchema(defs, ["going"]);
    expect(properties.map_time).toMatchObject({ type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" });
    expect(properties.map_date).toMatchObject({ type: "string", format: "date" });
    expect(Object.keys(properties)).toEqual(["display_name", "status", "guest_id", "map_time", "map_date"]);
    expect(required).toEqual(["display_name", "status", "map_time", "map_date"]);
  });
  it("keys the answers by definition id and drops the tool's own arguments", () => {
    expect(rsvpAnswers(asked, { display_name: "A", status: "going", name_on_map: "Maya", variant_size: "m", other: 1 })).toEqual({ def_1: "Maya", def_2: "m" });
  });
});
