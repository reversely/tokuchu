import { describe, expect, it } from "vitest";
import { deriveSchemaVersion } from "../domain/requirement-schema";
import { parseCustomization } from "./customization";

const PAYLOAD = {
  title: "Customized Crewneck",
  fields: [
    { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
    { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } },
    { key: "mystery", label: "Unknown", kind: "hologram", required: false }
  ],
  variants: [{ id: 41, title: "M", price_cents: 5000, available: true, options: [{ name: "Size", label: "M" }] }]
};

describe("parseCustomization", () => {
  it("normalizes the store's answer into a requirement schema with a derived id and version when the store gives none", () => {
    const parsed = parseCustomization(PAYLOAD, "CAD", { store_domain: "springbuilt.myshopify.com", product_id: "gid://shopify/Product/1" });
    expect(parsed.fields.map((f) => f.key)).toEqual(["star_map_location", "caption"]);
    expect(parsed.variants).toEqual([{ id: "41", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] }]);
    expect(parsed.schema).toEqual({ schema_id: "springbuilt.myshopify.com/gid://shopify/Product/1", version: deriveSchemaVersion(parsed.fields), product_id: "gid://shopify/Product/1", requirements: parsed.fields });
    expect(parseCustomization(PAYLOAD, "CAD", { store_domain: "springbuilt.myshopify.com", product_id: "gid://shopify/Product/1" }).schema.version).toBe(parsed.schema.version);
  });

  it("keeps the store's own schema id and version when it states them", () => {
    const parsed = parseCustomization({ ...PAYLOAD, schema_id: "crewneck-v2", schema_version: "2", product_id: "crewneck" }, "CAD", { store_domain: "springbuilt.myshopify.com", product_id: "gid://shopify/Product/1" });
    expect(parsed.schema).toMatchObject({ schema_id: "crewneck-v2", version: "2", product_id: "crewneck" });
  });

  it("changes the derived version when one constraint changes and keeps it when only a label changes", () => {
    const origin = { store_domain: "springbuilt.myshopify.com", product_id: "gid://shopify/Product/1" };
    const base = parseCustomization(PAYLOAD, "CAD", origin).schema.version;
    const capped = parseCustomization({ ...PAYLOAD, fields: [PAYLOAD.fields[0], { ...PAYLOAD.fields[1], constraints: { max_length: 12 } }] }, "CAD", origin).schema.version;
    const relabelled = parseCustomization({ ...PAYLOAD, fields: [PAYLOAD.fields[0], { ...PAYLOAD.fields[1], label: "Caption" }] }, "CAD", origin).schema.version;
    expect(capped).not.toBe(base);
    expect(relabelled).toBe(base);
  });
});
