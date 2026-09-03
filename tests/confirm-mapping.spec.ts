/**
 * Stored reconciliation decisions (#51): two questions share the name concept, so the store's caption
 * field waits for the organizer; the Attendees tab lists both candidates, Use this maps the chosen one
 * and the decision reads as confirmed by the organizer. A new schema version then shows the diff with
 * the attendee it affects, and Continue reruns the request step.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

const EVENT = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const FIELDS = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];
const GIFT = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "example-store.myshopify.com",
  product_title: "Customized Crewneck",
  variants: [
    { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
    { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
  ],
  personalization: { fields: FIELDS, schema_version: "v1" },
  default_variant_id: "v-m"
};

type Definition = { id: string; key: string };
type Decision = { decision: { requirement_id: string; decision: string; attribute_id?: string }; confirmed_by: string | null };
type Reconciliation = { schema_version: string; decisions: Decision[]; change: { from_version: string; to_version: string; continued_at: string | null } | null };

/** An event with two name questions (an ambiguous alias for the caption), the crewneck gift, and one going attendee. */
async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.put(`/api/events/${id}/definitions`, { data: { definitions: [
    { key: "printed_name", label: "Name for printing", scope: "guest", value_type: "text", constraints: { max_length: 40 }, required_rule: "going" },
    { key: "full_name", label: "Full name", scope: "guest", value_type: "text", constraints: {}, required_rule: "going" }
  ] } });
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  const { definitions } = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: Definition[] };
  const printed = definitions.find((d) => d.key === "printed_name")!;
  const reply = (await (await request.post(`/api/events/${id}/rsvp`, { data: { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [printed.id]: "Avery" } }] } })).json()) as { guest_ids: string[] };
  return { id, giftId: gift.id, printed, guestId: reply.guest_ids[0] };
}

test("the organizer confirms an ambiguous mapping and sees a schema change before the request step runs again", async ({ page, request }) => {
  const { id, giftId, printed, guestId } = await seed(request);
  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();

  const pending = page.getByTestId("confirm-requirement");
  await expect(pending).toHaveCount(1);
  await expect(pending).toHaveAttribute("data-key", "caption");
  await expect(pending).toContainText("2 fields could fill Text 2");
  await expect(page.getByTestId("confirm-candidate")).toHaveCount(2);
  await expect(page.getByTestId("requested-field").filter({ hasText: "Text 2" })).toHaveAttribute("data-source", "question");

  await page.locator(`[data-testid="confirm-candidate"][data-attribute="${printed.id}"]`).getByTestId("confirm-use").click();
  await expect(page.getByTestId("confirm-requirement")).toHaveCount(0);
  await expect(page.getByTestId("requested-field").filter({ hasText: "Text 2" })).toHaveAttribute("data-source", "definition");
  await expect(page.getByTestId("requested-field").filter({ hasText: "Text 2" })).toContainText("asked of attendees");

  const stored = (await (await request.get(`/api/events/${id}/gifts/${giftId}/reconcile`)).json()) as Reconciliation;
  expect(stored.schema_version).toBe("v1");
  expect(stored.decisions.find((d) => d.decision.requirement_id === "caption")).toMatchObject({ decision: { decision: "map_existing", attribute_id: printed.id }, confirmed_by: "organizer" });
  expect(stored.change).toBeNull();
  const changes = (await (await request.get(`/api/events/${id}/changes?gift=${giftId}&after=0`)).json()) as { changes: { type: string; summary: string }[] };
  expect(changes.changes.at(-1)).toMatchObject({ type: "mapping_changed", summary: "The organizer confirmed Text 2 fills from Name for printing" });

  // The request goes out, then the store's schema moves: the caption cap shrinks and a time field arrives.
  await page.getByTestId("request-fields").click();
  await expect(page.getByTestId("attendee-row")).toHaveAttribute("data-request", "incomplete");
  const next = [{ ...FIELDS[1], constraints: { max_length: 12 } }, { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} }];
  // The whole gift travels with the re-read schema, as a customization read sends it.
  const patched = await request.patch(`/api/events/${id}/gifts/${giftId}`, { data: { ...GIFT, personalization: { fields: next, schema_version: "v2" } } });
  expect(patched.ok()).toBe(true);
  await page.reload();
  await page.getByTestId("tab-attendees").click();
  const change = page.getByTestId("schema-change");
  await expect(change).toBeVisible();
  await expect(change).toHaveAttribute("data-from", "v1");
  await expect(change).toHaveAttribute("data-to", "v2");
  const rows = page.getByTestId("schema-change-requirement");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-change", "added");
  await expect(rows.nth(1)).toHaveAttribute("data-change", "removed");
  await expect(rows.nth(2)).toHaveAttribute("data-change", "changed");
  await expect(page.getByTestId("schema-change-attendee")).toHaveCount(1);
  await expect(page.getByTestId("schema-change-attendee")).toHaveAttribute("data-attendee", guestId);
  await expect(page.getByTestId("schema-change-attendee")).toContainText("Avery Chen");

  await page.getByTestId("schema-change-continue").click();
  await expect(page.getByTestId("schema-change")).toHaveCount(0);
  const after = (await (await request.get(`/api/events/${id}/gifts/${giftId}/reconcile`)).json()) as Reconciliation;
  expect(after.schema_version).toBe("v2");
  expect(after.change).toMatchObject({ from_version: "v1", to_version: "v2", continued_at: expect.any(String) });
  await expect(page.getByTestId("requested-field").filter({ hasText: "Pick a time" })).toHaveAttribute("data-source", "definition");
});
