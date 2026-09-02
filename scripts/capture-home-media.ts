/**
 * Records the five walkthrough clips the landing page shows, one GIF per step under public/media,
 * by running the flow through the real app against the live store the way tests/flow-demo.spec.ts
 * does: `LIVE_CUSTOMILY=1 npx tsx scripts/capture-home-media.ts` with the dev server up at APP_URL
 * (http://localhost:3113 by default), CUSTOMILY_SHOP_URL and OPENAI_API_KEY in the environment, and
 * docs/demo-event.json in place. Each step runs in its own browser context so Playwright writes one
 * video per step; the waits on the live store are cut out and the rest is sped up so every GIF lands
 * under the 1000 KB pre-commit limit. Needs ffmpeg and ffprobe on PATH.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";

const APP_URL = process.env.APP_URL ?? "http://localhost:3113";
const OUT_DIR = "public/media";
const WORK_DIR = "tests/videos/home-media";
const MAX_BYTES = 1_000_000;
const TARGET_SECONDS = 14;
const VIEWPORT = { width: 1280, height: 800 };
const KEY_DELAY_MS = 24;
const LIVE_MS = 240_000;
const STORE = "Customworks";

/** Width and frame-rate pairs tried in order until the GIF fits the size limit. */
const LADDER = [
  { width: 960, fps: 8 },
  { width: 960, fps: 6 },
  { width: 880, fps: 6 },
  { width: 800, fps: 5 },
  { width: 720, fps: 5 },
  { width: 640, fps: 4 }
];

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; search: string };
type Attendee = { display_name: string; size: string; location: string; time: string };
type Gift = { id: string; product_title: string; personalization: { fields: { key: string; label: string; kind: string; constraints?: { max_length?: number } }[] } | null; variants: { id: string; title: string }[]; checkout_url?: string | null; cart_fill?: { status: string } | null };
type Definition = { id: string; key: string; constraints: { options?: { value: string; label: string }[] } };

if (!process.env.LIVE_CUSTOMILY) throw new Error("Set LIVE_CUSTOMILY=1 to record against the live store.");
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
if (!existsSync(DEMO_PATH)) throw new Error(`No demo event at ${DEMO_PATH}.`);
const EVENT = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent;
const ATTENDEES = (JSON.parse(readFileSync("tests/fixtures/demo-attendees.json", "utf8")) as { attendees: Attendee[] }).attendees;

/**
 * One recorded step: a page with a video, plus the gaps to cut from it. A gap opens before a wait on
 * the live store and closes when the wait ends, so the clip keeps the screen changes and drops the
 * idle seconds.
 */
class Clip {
  private gaps: [number, number][] = [];
  private open: number | null = null;
  private constructor(readonly page: Page, private readonly started: number) {}

  static async start(browser: Browser): Promise<Clip> {
    const ctx = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: WORK_DIR, size: VIEWPORT } });
    const page = await ctx.newPage();
    // The dev server's corner badge would otherwise sit in every frame.
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.insertAdjacentHTML("beforeend", "<style>nextjs-portal{display:none}</style>")));
    return new Clip(page, Date.now());
  }
  private now(): number {
    return (Date.now() - this.started) / 1000;
  }
  skip(): void {
    this.open = this.now();
  }
  resume(): void {
    if (this.open !== null) this.gaps.push([this.open, this.now()]);
    this.open = null;
  }
  hold(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms);
  }
  async type(testId: string, text: string): Promise<void> {
    await this.page.getByTestId(testId).click();
    await this.page.keyboard.type(text, { delay: KEY_DELAY_MS });
  }
  /** A translucent panel naming the WebMCP call behind the step, held long enough to read. */
  async overlay(title: string, lines: string[], holdMs = 3500): Promise<void> {
    await this.page.evaluate(({ title, lines }) => {
      let el = document.getElementById("demo-webmcp");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-webmcp";
        el.style.cssText = "position:fixed;top:88px;right:30px;z-index:9998;width:480px;max-width:44vw;padding:16px 18px 18px;border-radius:12px;background:rgba(11,16,32,.8);color:#EAF3FC;font:13px/1.7 ui-monospace,Menlo,monospace;box-shadow:0 16px 44px rgba(0,0,0,.4);pointer-events:none";
        document.body.appendChild(el);
      }
      el.innerHTML = `<div style="font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8FD0FF;margin-bottom:10px">${title}</div>` + lines.map((l) => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l}</div>`).join("");
    }, { title, lines });
    await this.hold(holdMs);
    await this.page.evaluate(() => document.getElementById("demo-webmcp")?.remove());
  }
  /** Closes the context and writes the GIF; the video file exists once the context is closed. */
  async finish(name: string): Promise<void> {
    this.resume();
    const video = this.page.video();
    await this.page.context().close();
    const source = await video!.path();
    encodeGif(source, `${OUT_DIR}/${name}.gif`, this.gaps);
  }
}

function seconds(source: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], { encoding: "utf8" }).trim());
}

/** Cuts the gaps, speeds the rest to the target length, and steps down the ladder until the GIF fits. */
function encodeGif(source: string, target: string, gaps: [number, number][]): void {
  const cut = gaps.reduce((sum, [from, to]) => sum + (to - from), 0);
  const kept = Math.max(1, seconds(source) - cut);
  const speed = Math.max(1, kept / TARGET_SECONDS);
  const keep = gaps.length ? `select='not(${gaps.map(([from, to]) => `between(t,${from.toFixed(2)},${to.toFixed(2)})`).join("+")})',` : "";
  for (const { width, fps } of LADDER) {
    const filter = `${keep}setpts=N/FRAME_RATE/TB,setpts=PTS/${speed.toFixed(3)},fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", source, "-filter_complex", filter, "-loop", "0", target]);
    const size = statSync(target).size;
    console.log(`${target}: ${width}px at ${fps} fps, ${(size / 1024).toFixed(0)} KB (${kept.toFixed(0)}s kept at ${speed.toFixed(1)}x)`);
    if (size <= MAX_BYTES) return;
  }
  throw new Error(`${target} stays over ${MAX_BYTES} bytes at the smallest setting.`);
}

async function gift(page: Page, eventId: string): Promise<Gift> {
  const snap = (await (await page.request.get(`${APP_URL}/api/events/${eventId}`)).json()) as { gifts: Gift[] };
  return snap.gifts[0];
}

async function step1Create(browser: Browser): Promise<string> {
  const clip = await Clip.start(browser);
  const { page } = clip;
  await page.goto(`${APP_URL}/events/new`);
  await clip.hold(800);
  await clip.type("title", EVENT.title);
  await page.getByTestId("starts_at").fill(EVENT.starts_at);
  await clip.type("host", EVENT.host);
  await clip.type("venue_name", EVENT.venue.name);
  await page.getByTestId("line1").fill(EVENT.venue.line1);
  await page.getByTestId("city").fill(EVENT.venue.city);
  await page.getByTestId("region").fill(EVENT.venue.region);
  await page.getByTestId("postal_code").fill(EVENT.venue.postal_code);
  await page.getByTestId("country").fill(EVENT.venue.country);
  await page.getByTestId("spots").fill(EVENT.spots);
  await page.getByTestId("cost").fill(EVENT.cost);
  await page.getByTestId("deadline").fill(EVENT.deadline);
  await page.getByTestId("needed_by").fill(EVENT.needed_by);
  await clip.hold(1200);
  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  const eventId = page.url().split("/events/")[1];
  await page.getByTestId("status").filter({ hasText: "Published" }).waitFor();
  await clip.hold(2500);
  await clip.finish("step1-create");
  return eventId;
}

async function step2SearchAndPick(browser: Browser, eventId: string): Promise<void> {
  const clip = await Clip.start(browser);
  const { page } = clip;
  await page.goto(`${APP_URL}/events/${eventId}?webmcp=polyfill`);
  await page.getByTestId("tab-experience").click();
  await clip.hold(800);
  await clip.type("sentence", EVENT.search);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await clip.hold(1500);
  clip.skip();
  await page.getByTestId("results").waitFor({ timeout: LIVE_MS });
  await page.getByTestId("result").first().waitFor();
  const storeResult = page.getByTestId("result").filter({ hasText: STORE }).first();
  for (let i = 0; i < 6 && (await storeResult.count()) === 0; i++) await page.getByTestId("show-more").click().catch(() => undefined);
  await storeResult.waitFor({ timeout: 10_000 });
  clip.resume();
  const rows = await page.locator('[data-testid="funnel"] .row').evaluateAll((els) => els.map((r) => (r.textContent || "").replace(/\s+/g, " ").trim()));
  await clip.overlay("search_catalog", ["catalog.shopify.com/api/ucp/mcp", ...rows.map((r) => `→ ${r}`), `← ${await page.getByTestId("result").count()} ranked products`]);
  await storeResult.scrollIntoViewIfNeeded();
  await clip.hold(800);
  await storeResult.click();
  await page.getByTestId("recipients").waitFor({ timeout: 10_000 });
  await clip.hold(1200);
  await page.getByTestId("next").click();
  await page.getByTestId("confirm").waitFor({ timeout: 10_000 });
  await clip.hold(1200);
  await page.getByTestId("confirm").click();
  await clip.hold(1500);
  clip.skip();
  await page.getByTestId("gift").waitFor({ timeout: 120_000 });
  clip.resume();
  await clip.hold(2500);
  await clip.finish("step2-search-pick");
}

async function step3Requirements(browser: Browser, eventId: string): Promise<void> {
  const clip = await Clip.start(browser);
  const { page } = clip;
  const stored = await gift(page, eventId);
  const fields = stored.personalization?.fields ?? [];
  await page.goto(`${APP_URL}/events/${eventId}?webmcp=polyfill`);
  await page.getByTestId("tab-experience").click();
  await page.getByTestId("gift").waitFor();
  await clip.hold(1000);
  await clip.overlay("get_customization", [`product ${stored.product_title}`, ...fields.map((f) => `• ${f.label} (${f.kind}${f.constraints?.max_length ? ` up to ${f.constraints.max_length}` : ""})`), `← ${stored.variants.length} variants`], 4500);
  await page.getByTestId("tab-attendees").click();
  await page.getByTestId("requested-info").waitFor({ timeout: 10_000 });
  await page.getByTestId("requested-field").filter({ hasText: "Size" }).waitFor({ timeout: 10_000 });
  await clip.hold(3500);
  await clip.finish("step3-requirements");
}

async function step4RequestAndRecords(browser: Browser, eventId: string): Promise<void> {
  const clip = await Clip.start(browser);
  const { page } = clip;
  await page.goto(`${APP_URL}/events/${eventId}?webmcp=polyfill`);
  await page.getByTestId("tab-attendees").click();
  await page.getByTestId("requested-field").filter({ hasText: "Size" }).waitFor({ timeout: 10_000 });
  await clip.hold(1000);
  await page.getByTestId("request-fields").click();
  await page.locator('[data-testid="requested-field"][data-source="definition"]').first().waitFor({ timeout: 10_000 });
  await clip.hold(1500);
  // The replies load through the RSVP API in place of email replies, one attendee at a time so the grid fills row by row.
  const snap = (await (await page.request.get(`${APP_URL}/api/events/${eventId}`)).json()) as { definitions: Definition[] };
  const def = (key: string) => snap.definitions.find((d) => d.key === key)!;
  const sizeDef = def("variant_size");
  const sizeValue = (label: string) => sizeDef.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? sizeDef.constraints.options?.[0]?.value;
  for (const a of ATTENDEES) {
    const rsvp = await page.request.post(`${APP_URL}/api/events/${eventId}/rsvp`, { data: { guests: [{ display_name: a.display_name, status: "going", answers: { [sizeDef.id]: sizeValue(a.size), [def("star_map_location").id]: a.location, [def("star_map_time").id]: a.time } }] } });
    if (!rsvp.ok()) throw new Error(await rsvp.text());
    await clip.hold(1200);
  }
  await page.locator('[data-testid="attendee-row"]').nth(ATTENDEES.length - 1).waitFor({ timeout: 10_000 });
  await page.getByTestId("attendees-grid").scrollIntoViewIfNeeded();
  await clip.hold(3000);
  await clip.finish("step4-request-records");
}

async function step5ApproveAndCheckout(browser: Browser, eventId: string): Promise<void> {
  const clip = await Clip.start(browser);
  const { page } = clip;
  await page.goto(`${APP_URL}/events/${eventId}?webmcp=polyfill`);
  await page.getByTestId("tab-attendees").click();
  await page.getByTestId("approve-send").waitFor({ timeout: 10_000 });
  await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
  await clip.hold(1200);
  await page.getByTestId("approve-send").click();
  await page.getByTestId("specs-approved").waitFor({ timeout: 25_000 });
  await clip.hold(1500);
  clip.skip();
  await page.getByTestId("review-cart").waitFor({ timeout: 180_000 });
  clip.resume();
  const checkoutUrl = (await page.getByTestId("review-cart").getAttribute("href")) ?? "";
  await clip.overlay("add_customized_to_cart", [`${ATTENDEES.length} items and one per attendee`, ...ATTENDEES.map((a) => `• ${a.display_name} ${a.size} ${a.location} ${a.time}`), `← checkout_url ${checkoutUrl.split("?")[0]}`], 4500);
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
  clip.skip();
  for (const a of ATTENDEES) await page.locator("body").filter({ hasText: a.display_name }).waitFor({ timeout: 60_000 });
  clip.resume();
  await clip.hold(4000);
  await clip.finish("step5-approve-checkout");
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(WORK_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  const eventId = await step1Create(browser);
  await step2SearchAndPick(browser, eventId);
  await step3Requirements(browser, eventId);
  await step4RequestAndRecords(browser, eventId);
  await step5ApproveAndCheckout(browser, eventId);
} finally {
  await browser.close();
}
