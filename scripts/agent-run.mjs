/**
 * The browser agent runtime (#60): Stagehand launches the local Chrome with its WebMCP flags, so
 * document.modelContext is Chrome's own, and an OpenAI Agents SDK agent reads docs/agent-runtime.md
 * and one goal sentence, then discovers and calls the tools the Tokuchu and store pages register.
 * This launcher is a fixture-driven demonstration: it seeds the guest list an organizer would have
 * collected and names the demo store's product in the prompt. The runtime itself names no tool. It prints each function call and
 * result as one line, and writes the transcript beside the videos in tests/videos.
 *
 *   TOKUCHU_STATIC=1 npm run dev -- -p 3114                 # in one shell
 *   npm run agent-run -- "Order the crewneck for everyone going and report the checkout link."
 *
 * AGENT_BASE names the Tokuchu server (default http://localhost:3114); OPENAI_AGENT_MODEL the model;
 * OPENAI_API_KEY comes from the environment or .env.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { DEFAULT_MODEL, runBrowserAgent, short } from "../src/agent/agent-run.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: the key comes from the environment.
}

const BASE = (process.env.AGENT_BASE ?? "http://localhost:3114").replace(/\/+$/, "");
const MODEL = process.env.OPENAI_AGENT_MODEL ?? DEFAULT_MODEL;
const SHOP_DOMAIN = "springbuilt.myshopify.com";
const PRODUCT_ID = "10242071789817";
const PRODUCT_URL = `https://${SHOP_DOMAIN}/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt`;
const DEMO_HEADER = "x-tokuchu-demo";
const OUT = "tests/videos";
const ATTENDEES = JSON.parse(readFileSync("tests/fixtures/demo-attendees.json", "utf8")).attendees;

const goal = process.argv.slice(2).join(" ").trim();
if (!goal) {
  console.error('Usage: npm run agent-run -- "<goal>"');
  process.exit(2);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set; put it in .env or the environment.");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const transcriptPath = `${OUT}/agent-run-${stamp}.json`;
const transcript = { goal, model: MODEL, base: BASE, started_at: new Date().toISOString(), events: [], outcome: null };
const save = () => writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));

/** One JSON call to Tokuchu's API as the demo guest, for the setup an organizer would have done by hand. */
async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", [DEMO_HEADER]: token }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${json.error ?? JSON.stringify(json)}`);
  return json;
}

/** The demo guest's event and token: /demo redirects to /events/<id>?t=<token>. */
async function demoSession() {
  const res = await fetch(`${BASE}/demo`, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`${BASE}/demo did not redirect (status ${res.status}); is the static server running?`);
  const url = new URL(location, BASE);
  const eventId = url.pathname.split("/").pop();
  const token = url.searchParams.get("t");
  if (!eventId || !token) throw new Error(`Unexpected demo redirect ${location}`);
  return { eventId, token };
}

const line = (event) => {
  if (event.kind === "call") return `[${event.seq}] → ${event.tool} ${short(event.args)}`;
  if (event.kind === "result") return `[${event.seq}] ← ${event.ok ? "ok" : "error"} ${event.summary}`;
  return `\n${event.text}`;
};

async function main() {
  const { eventId, token } = await demoSession();
  const snap = await api("GET", `/api/events/${eventId}`, token);
  if (!snap.static) throw new Error(`The server at ${BASE} is not in static mode; start it with TOKUCHU_STATIC=1.`);
  if (snap.guests.length === 0) await api("POST", `/api/events/${eventId}/rsvp`, token, { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going" })) });
  const inviteCode = snap.event.invite_code;
  console.log(`Tokuchu event ${eventId} at ${BASE} with ${ATTENDEES.length} attendees going; model ${MODEL}; transcript ${transcriptPath}`);
  mkdirSync(OUT, { recursive: true });
  save();

  const playbook = readFileSync("docs/agent-runtime.md", "utf8");
  const answers = ATTENDEES.map((a) => `${a.display_name}: size ${a.size}, star map location ${a.location}, star map time ${a.time}`).join("; ");
  const prompt = [
    goal,
    "",
    "Context for this run:",
    `Tokuchu event page: ${BASE}/demo?t=${encodeURIComponent(token)} (opens the guest event ${eventId}).`,
    `Store product page: ${PRODUCT_URL} (product id ${PRODUCT_ID}, shop domain ${SHOP_DOMAIN}).`,
    `Attendee invite pages: ${BASE}/i/${inviteCode}?guest=<guest id> with the guest id from list_guests; each registers submit_rsvp. When Tokuchu names an attendee as missing an answer, open that attendee's invite page and answer for them with submit_rsvp, using their existing display_name and status going.`,
    `The attendees' answers when asked: ${answers}.`
  ].join("\n");

  const browser = await localBrowser.launch({ headless: false, viewport: { width: 1440, height: 900 } });
  const stagehand = await Stagehand.create({ browser });
  try {
    const outcome = await runBrowserAgent({
      context: browser.context,
      goal: prompt,
      playbook,
      model: MODEL,
      onEvent: (event) => {
        console.log(line(event));
        transcript.events.push(event);
        save();
      }
    });
    transcript.outcome = { turns: outcome.turns, calls: outcome.calls, checkout_url: outcome.checkout_url, final_output: outcome.final_output, ended_at: new Date().toISOString() };
    save();
    console.log(`\n${outcome.turns} model turns, ${outcome.calls} function calls; checkout link ${outcome.checkout_url ?? "not reached"}; transcript ${transcriptPath}`);
    return outcome.checkout_url ? 0 : 1;
  } finally {
    await stagehand.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    transcript.outcome = { error: e instanceof Error ? e.message : String(e), ended_at: new Date().toISOString() };
    save();
    process.exit(1);
  });
