/**
 * Proactive status posts (#34): after an RSVP write, a cart run, or a post into a gift's progress
 * log the assistant posts into the event's chat on its own. The triggers note the change; a
 * per-event debounce turns a burst of replies into one post, which runs after the noting request
 * has written its row, in a persisted scope of its own. With the agent on, the post is written
 * from the current state through its tools with an instruction to say only what changed; with it
 * off, a deterministic line stands in. A posted update names its actor from the change log, so a
 * store's post and the organizer's read as different people.
 */
import type { Model } from "@openai/agents";
import { runWithState, state, guestsFor, type State } from "../domain/store";
import { giftsFor } from "../domain/gifts";
import type { ChangeEntry, ChatMessage } from "../domain/types";
import { followUps } from "./api";
import { lastSystemMessage, postMessage } from "./chat";
import { hasDatabase } from "./db";
import { llmEnabled } from "./flags";
import { afterCommit, withPersistedEvent } from "./persistence";

/** What happened: replies were written, a cart job reported on a gift, or an update was posted on a gift. */
export type Reason = { kind: "rsvp" } | { kind: "cart"; gift_id: string } | { kind: "update"; gift_id: string };

export type ProactiveConfig = {
  /** How long a burst of triggers waits before one post; a few seconds covers a party's replies. */
  delayMs: number;
  /** Whether the agent writes the post; the LLM flag decides by default. */
  llm?: boolean;
  /** A scripted model for tests. */
  model?: Model;
};

const DEFAULTS: ProactiveConfig = { delayMs: 3000 };
let config: ProactiveConfig = DEFAULTS;

/** Test hook: the debounce and the model; null restores the defaults. */
export function configureProactive(patch: Partial<ProactiveConfig> | null): void {
  config = patch ? { ...DEFAULTS, ...patch } : DEFAULTS;
}

type Pending = { timer: ReturnType<typeof setTimeout>; reasons: Reason[]; commits: Promise<void>[]; captured: State };

const pending = new Map<string, Pending>();
const inFlight = new Map<string, Promise<void>>();

/** Notes a change and arms the event's debounce; the post runs once the noting request's row is written. */
function note(eventId: string, reason: Reason): void {
  const entry = pending.get(eventId) ?? { timer: setTimeout(() => undefined, 0), reasons: [], commits: [], captured: state() };
  clearTimeout(entry.timer);
  entry.reasons.push(reason);
  entry.commits.push(afterCommit());
  entry.timer = setTimeout(() => void fire(eventId), config.delayMs);
  entry.timer.unref?.();
  pending.set(eventId, entry);
}

export function noteRsvpWrite(eventId: string): void {
  note(eventId, { kind: "rsvp" });
}

export function noteCartResult(eventId: string, giftId: string): void {
  note(eventId, { kind: "cart", gift_id: giftId });
}

export function noteUpdatePosted(eventId: string, giftId: string): void {
  note(eventId, { kind: "update", gift_id: giftId });
}

/**
 * Runs the post for the event's noted reasons. With a database the post loads the row afresh; in
 * memory it runs under the State the triggers saw, so a store reset in between orphans the post
 * instead of landing it in a later event that reuses the id.
 */
function fire(eventId: string): Promise<void> {
  const entry = pending.get(eventId);
  if (!entry) return inFlight.get(eventId) ?? Promise.resolve();
  pending.delete(eventId);
  clearTimeout(entry.timer);
  const previous = inFlight.get(eventId) ?? Promise.resolve();
  const job = Promise.all([previous, ...entry.commits])
    .then(() => (hasDatabase() ? withPersistedEvent(eventId, () => postProactive(eventId, entry.reasons)) : runWithState(entry.captured, () => postProactive(eventId, entry.reasons))))
    .then(() => undefined)
    .catch((e: unknown) => console.error(`The proactive post for event ${eventId} failed: ${(e as Error).message}`))
    .finally(() => {
      if (inFlight.get(eventId) === job) inFlight.delete(eventId);
    });
  inFlight.set(eventId, job);
  return job;
}

/** Test hook: posts what is pending for the event now and waits for it. */
export function flushProactive(eventId: string): Promise<void> {
  return fire(eventId);
}

/* ---- The post ---- */

const RSVP_STATUS: Record<string, string> = { going: "going", maybe: "maybe", cant_go: "not going", no_reply: "without a reply" };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The change-log entries written since the last system line, or all of them with none. */
function changesSinceLastPost(eventId: string, since: string | null): ChangeEntry[] {
  return state().changes.filter((c) => c.event_id === eventId && (!since || c.at > since));
}

/** The deterministic RSVP line: the replies since the last post by status, what is still missing, and who has no address. */
function rsvpLine(eventId: string, since: string | null): string | null {
  const changes = changesSinceLastPost(eventId, since);
  const statuses = changes.filter((c) => c.kind === "status");
  const answers = changes.filter((c) => c.kind === "value");
  if (!statuses.length && !answers.length) return null;
  const byStatus = new Map<string, number>();
  for (const c of statuses) byStatus.set(c.to, (byStatus.get(c.to) ?? 0) + 1);
  const parts: string[] = [];
  if (statuses.length) parts.push(`${plural(statuses.length, "reply", "replies")} arrived: ${[...byStatus].map(([s, n]) => `${n} ${RSVP_STATUS[s] ?? s}`).join(", ")}.`);
  else parts.push(`${plural(answers.length, "answer", "answers")} arrived.`);
  const missing = followUps(eventId).filter((f) => f.kind === "missing_value").reduce((n, f) => n + f.guest_ids.length, 0);
  const unaddressed = guestsFor(eventId).filter((g) => g.status === "going" && !state().parties.get(g.party_id)?.contact.email).length;
  if (missing) parts.push(`${plural(missing, "required answer is", "required answers are")} still missing; request them from the gift's page.`);
  if (unaddressed) parts.push(`${plural(unaddressed, "going guest has", "going guests have")} no email address, so a request cannot reach them.`);
  if (!missing && !unaddressed) parts.push("Nothing is waiting on you.");
  return parts.join(" ");
}

/** The deterministic cart line: where the gift's cart stands and the organizer's next step. */
function cartLine(eventId: string, giftId: string): string | null {
  const gift = giftsFor(eventId).find((g) => g.id === giftId);
  if (!gift) return null;
  const title = gift.product_title || gift.product_id;
  const fill = gift.cart_fill;
  if (fill?.status === "done") return `The cart for ${title} at ${gift.shop_domain} is ready to review${gift.checkout_url ? `: ${gift.checkout_url}` : ""}.${gift.cart_blocked?.length ? ` The store refused ${plural(gift.cart_blocked.length, "item", "items")}; check the rows it names.` : ""}`;
  if (fill?.status === "failed") return `The cart for ${title} failed: ${fill.reason ?? "no reason given"}. Fix the rows it names and approve again.`;
  if (fill?.status === "running") return `The cart for ${title} is filling.`;
  return null;
}

/** Who wrote a change-log entry, in the organizer's words: the store or the agent by its grantee id, the organizer, an attendee, or Tokuchu. */
function actorLabel(entry: ChangeEntry): string {
  switch (entry.actor_type) {
    case "vendor":
      return entry.actor_id ? `The store ${entry.actor_id}` : "The store";
    case "agent":
      return entry.actor_id ? `The agent ${entry.actor_id}` : "An agent";
    case "attendee":
      return "An attendee";
    case "system":
      return "Tokuchu";
    default:
      return "The organizer";
  }
}

/** The deterministic update line: each actor's posts on the gift since the last post with the last one's words. */
function updateLine(eventId: string, giftId: string, since: string | null): string | null {
  const gift = giftsFor(eventId).find((g) => g.id === giftId);
  if (!gift) return null;
  const title = gift.product_title || gift.product_id;
  const posts = changesSinceLastPost(eventId, since).filter((c) => c.kind === "update" && c.gift_id === giftId);
  if (!posts.length) return null;
  const byActor = new Map<string, ChangeEntry[]>();
  for (const c of posts) byActor.set(actorLabel(c), [...(byActor.get(actorLabel(c)) ?? []), c]);
  return [...byActor].map(([actor, rows]) => `${actor} posted ${plural(rows.length, "update", "updates")} on ${title}: ${rows[rows.length - 1].summary ?? "no words"}.`).join(" ");
}

function deterministicPost(eventId: string, reasons: Reason[], since: string | null): string | null {
  const lines: string[] = [];
  const carts = new Set(reasons.flatMap((r) => (r.kind === "cart" ? [r.gift_id] : [])));
  for (const giftId of carts) {
    const line = cartLine(eventId, giftId);
    if (line) lines.push(line);
  }
  for (const giftId of new Set(reasons.flatMap((r) => (r.kind === "update" ? [r.gift_id] : [])))) {
    const line = updateLine(eventId, giftId, since);
    if (line) lines.push(line);
  }
  if (reasons.some((r) => r.kind === "rsvp")) {
    const line = rsvpLine(eventId, since);
    if (line) lines.push(line);
  }
  return lines.length ? lines.join(" ") : null;
}

function describe(reasons: Reason[]): string {
  const out: string[] = [];
  if (reasons.some((r) => r.kind === "rsvp")) out.push("RSVP replies were written");
  for (const giftId of new Set(reasons.flatMap((r) => (r.kind === "cart" ? [r.gift_id] : [])))) out.push(`the cart job reported on gift ${giftId}`);
  for (const giftId of new Set(reasons.flatMap((r) => (r.kind === "update" ? [r.gift_id] : [])))) out.push(`an update was posted on gift ${giftId}`);
  return out.join(" and ");
}

async function agentPost(eventId: string, reasons: Reason[], last: ChatMessage | null): Promise<string | null> {
  const { runCurationAgent } = await import("../agent/curation-agent");
  const prompt = [
    `Something changed: ${describe(reasons)}.`,
    "Read the current state through your tools and write the organizer at most three short sentences that say only what changed and what to do about it: replies arriving, a request completing or stalling, an attendee with no email address, a cart filled or failed, a store's update on an order, or a needed-by date within the delivery window with rows still missing. Name who posted an update from the change's actor: the store or agent by its id, or the organizer.",
    "Do not search for products or select a gift. Reply with the post only, or with the single word NOTHING when nothing worth raising changed.",
    last ? `The last system line said: "${last.text}". Do not repeat it.` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const result = await runCurationAgent({ eventId }, prompt, config.model ? { model: config.model } : {});
  const text = result.response.trim();
  return !text || /^nothing\.?$/i.test(text) ? null : text;
}

/** Writes and posts the line for the reasons, or nothing when there is nothing new to say or the last system line already said it. */
export async function postProactive(eventId: string, reasons: Reason[]): Promise<ChatMessage | null> {
  const last = lastSystemMessage(eventId);
  const text = (config.llm ?? llmEnabled()) ? await agentPost(eventId, reasons, last) : deterministicPost(eventId, reasons, last?.at ?? null);
  if (!text || text === last?.text) return null;
  return postMessage(eventId, "system", text);
}
