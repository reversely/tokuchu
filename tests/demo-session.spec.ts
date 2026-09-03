/**
 * The guest session through the browser: `/demo` sets the signed cookie, repeats its value as the
 * `t` token in the URL, creates the seeded event, and lands on its dashboard with the guest band; a
 * second visit lands on the same event; the guest lists only its event, gets 401 with the sign-in
 * path on a create, and sees the page naming another organizer on an event it does not own; the
 * event list and the draft page send the guest to sign-in with its event and token as `next`. The
 * server runs without DATABASE_URL, so a request with no cookie is the local organizer. The tour
 * mounts on the demo event with its first step, lists search_catalog in its second step's wire, and
 * stays off an ordinary event. A browser that drops the cookie keeps the session through the token:
 * the dashboard renders and the page tools still write to the event.
 */
import { expect, test, type Page } from "@playwright/test";
import { STEPS } from "../src/demo/steps";
import { DEMO_HEADER } from "../src/demo/token";

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
}

const GIFT = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "example.myshopify.com",
  product_title: "Customized Crewneck",
  variants: [{ id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] }],
  personalization: { fields: [{ key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }] },
  default_variant_id: "v-m"
};

const BODY = { title: "Someone else's event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const DEMO_TITLE = "8th Annual Eastern Canada Astronomy Symposium";

test("a visitor gets one demo event and keeps it across visits", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("demo")).toHaveAttribute("href", "/demo");
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/events\/[^/?]+\?t=demo_[^&]+$/);
  const landed = new URL(page.url());
  const id = landed.pathname.split("/")[2];
  await expect(page.getByTestId("status")).toHaveText("Published");
  await expect(page.getByTestId("event-title")).toHaveText(DEMO_TITLE);
  await expect(page.getByTestId("guest-pill")).toHaveText("Guest demo");
  await expect(page.getByTestId("tour-narration")).toHaveText(STEPS[0].narration);
  await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("tour-autoplay")).not.toBeChecked();
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("tour-wire")).toContainText("search_catalog");
  await page.getByTestId("tour-back").click();
  await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "1");

  const cookie = (await page.context().cookies()).find((c) => c.name === "tokuchu_demo");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(cookie!.value).toMatch(/^demo_[A-Za-z0-9_-]{16}\.[0-9a-f]{64}$/);
  expect(landed.searchParams.get("t")).toBe(cookie!.value);
  const keep = `/sign-in?next=${encodeURIComponent(`/events/${id}?t=${encodeURIComponent(cookie!.value)}`)}`;
  await expect(page.getByTestId("keep-event-link")).toHaveAttribute("href", keep);

  await page.goto("/demo");
  await expect(page).toHaveURL(`/events/${id}?t=${cookie!.value}`);
  expect((await page.context().cookies()).find((c) => c.name === "tokuchu_demo")?.value).toBe(cookie!.value);

  const snap = (await (await page.request.get(`/api/events/${id}`)).json()) as { demo: boolean; event: { title: string } };
  expect(snap.demo).toBe(true);
  expect(snap.event.title).toBe(DEMO_TITLE);

  const listed = (await (await page.request.get("/api/events")).json()) as { events: { id: string }[] };
  expect(listed.events.map((e) => e.id)).toEqual([id]);
  const second = await page.request.post("/api/events", { data: BODY });
  expect(second.status()).toBe(401);
  expect(await second.json()).toEqual({ error: "Create an account to keep this event.", sign_in: keep });

  // The guest's pages that need an account go to sign-in and come back to the event with the token.
  await page.goto("/events");
  await expect(page).toHaveURL(keep);
  await page.goto("/events/new");
  await expect(page).toHaveURL(keep);
  await page.goto("/");
  await expect(page.getByTestId("start")).toHaveAttribute("href", "/sign-in?next=%2Fevents%2Fnew");

  // The bare request fixture carries no cookie, so it is the local organizer and its event is not the guest's.
  const theirs = (await (await request.post("/api/events", { data: BODY })).json()) as { id: string };
  expect((await page.request.get(`/api/events/${theirs.id}`)).status()).toBe(403);
  await page.goto(`/events/${theirs.id}`);
  await expect(page.getByTestId("forbidden-title")).toHaveText("This event belongs to another organizer");
  await expect(page.getByTestId("forbidden-events-link")).toHaveAttribute("href", "/events");
});

test("a browser that drops the demo cookie keeps the session through the URL token", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("/demo");
    await expect(page).toHaveURL(/\/events\/[^/?]+\?t=demo_[^&]+$/);
    const landed = new URL(page.url());
    const id = landed.pathname.split("/")[2];
    const token = landed.searchParams.get("t")!;
    await context.clearCookies();
    expect(await context.cookies()).toEqual([]);

    // The page tools need the polyfill in Playwright's Chromium; the reload otherwise repeats the landed URL.
    landed.searchParams.set("webmcp", "polyfill");
    await page.goto(landed.toString());
    await expect(page).toHaveURL(landed.toString());
    await expect(page.getByTestId("event-title")).toHaveText(DEMO_TITLE);
    await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "1");
    await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });

    // A cookie-less request without the header is the local organizer, which the demo event refuses.
    expect((await page.request.get(`/api/events/${id}`)).status()).toBe(401);
    const gift = await page.request.post(`/api/events/${id}/gifts`, { data: GIFT, headers: { [DEMO_HEADER]: token } });
    expect(gift.ok()).toBe(true);
    const { id: giftId } = (await gift.json()) as { id: string };

    const requested = await execute(page, "request_from_attendees", { gift_id: giftId });
    expect(requested.isError).toBe(false);
    expect(JSON.parse(requested.text) as { demo: boolean; event: { id: string } }).toMatchObject({ demo: true, event: { id } });
  } finally {
    await context.close();
  }
});

test("the tour stays off an event that is not the demo", async ({ page }) => {
  const theirs = (await (await page.request.post("/api/events", { data: BODY })).json()) as { id: string };
  await page.goto(`/events/${theirs.id}`);
  await expect(page.getByTestId("event-title")).toHaveText(BODY.title);
  await expect(page.getByTestId("tour")).toHaveCount(0);
});
