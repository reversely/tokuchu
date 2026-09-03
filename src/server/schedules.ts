/**
 * Scheduled actions (#33): the organizer's "remind everyone on Friday at 9" becomes a Schedule row
 * with a run time resolved in the event's zone. This module owns the zone choice, the phrase
 * parser, the rows (create, list, cancel, due), and one run of a due row; the tick (tick.ts) loops
 * over the due rows and supplies the live dependencies.
 */
import { getEvent, getGuest, guestsFor, newId, requestsFor, state, valuesFor } from "../domain/store";
import { giftsFor } from "../domain/gifts";
import type { ChatMessage, Event, Guest, Schedule, ScheduleAction, Venue } from "../domain/types";
import { followUp, followUps, requireGift } from "./api";
import { postMessage } from "./chat";
import { BadRequestError, NotFoundError } from "./errors";
import { mailer, type Mailer } from "./mail";
import { attendeeLink } from "./request-mail";

/* ---- The event's zone ---- */

export const DEFAULT_ZONE = "America/Toronto";

const COUNTRY_ALIASES: Record<string, string> = { CANADA: "CA", "UNITED STATES": "US", USA: "US", "UNITED STATES OF AMERICA": "US", "UNITED KINGDOM": "GB", UK: "GB", ENGLAND: "GB", JAPAN: "JP", AUSTRALIA: "AU", FRANCE: "FR", GERMANY: "DE" };

/** Countries with one zone for the purpose of a reminder, and the regions of the two that span several. */
const COUNTRY_ZONES: Record<string, string> = { CA: "America/Toronto", US: "America/New_York", MX: "America/Mexico_City", BR: "America/Sao_Paulo", GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin", NL: "Europe/Amsterdam", BE: "Europe/Brussels", ES: "Europe/Madrid", IT: "Europe/Rome", CH: "Europe/Zurich", SE: "Europe/Stockholm", IN: "Asia/Kolkata", SG: "Asia/Singapore", JP: "Asia/Tokyo", KR: "Asia/Seoul", AU: "Australia/Sydney", NZ: "Pacific/Auckland" };
const REGION_ZONES: Record<string, Record<string, string>> = {
  CA: { BC: "America/Vancouver", YT: "America/Whitehorse", AB: "America/Edmonton", NT: "America/Yellowknife", SK: "America/Regina", MB: "America/Winnipeg", NS: "America/Halifax", NB: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns" },
  US: { CA: "America/Los_Angeles", WA: "America/Los_Angeles", OR: "America/Los_Angeles", NV: "America/Los_Angeles", AZ: "America/Phoenix", CO: "America/Denver", UT: "America/Denver", MT: "America/Denver", NM: "America/Denver", ID: "America/Boise", TX: "America/Chicago", IL: "America/Chicago", MN: "America/Chicago", WI: "America/Chicago", MO: "America/Chicago", LA: "America/Chicago", OK: "America/Chicago", KS: "America/Chicago", NE: "America/Chicago", IA: "America/Chicago", AR: "America/Chicago", MS: "America/Chicago", AL: "America/Chicago", TN: "America/Chicago", AK: "America/Anchorage", HI: "Pacific/Honolulu" }
};

/** The zone the venue's country and region name, and America/Toronto when the table has neither. */
export function eventZone(venue: Pick<Venue, "country" | "region">): string {
  const raw = venue.country.trim().toUpperCase();
  const country = COUNTRY_ALIASES[raw] ?? raw;
  const region = venue.region.trim().toUpperCase();
  return REGION_ZONES[country]?.[region] ?? COUNTRY_ZONES[country] ?? DEFAULT_ZONE;
}

/* ---- Zone arithmetic over Intl ---- */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

/** The wall clock in the zone at an instant. */
function wallIn(date: Date, zone: string): Wall {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: WEEKDAYS.indexOf(p.weekday.toLowerCase()) };
}

function offsetMinutes(date: Date, zone: string): number {
  const w = wallIn(date, zone);
  return (Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - date.getTime()) / 60_000;
}

/** The instant at which the zone's wall clock reads the given date and time; a second pass settles a daylight-saving edge. */
function fromWall(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = new Date(guess - offsetMinutes(new Date(guess), zone) * 60_000);
  return new Date(guess - offsetMinutes(first, zone) * 60_000);
}

/** The instant rendered in the zone for the organizer: "Fri, 2026-09-04, 09:00 EDT". */
export function formatLocal(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/* ---- The phrase parser ---- */

/** A phrase resolved to an instant and a repeat, or the question to ask when the phrase leaves the time open. */
export type Resolved = { run_at: string; every_minutes: number | null; local: string; zone: string } | { ambiguous: string };

type Clock = { hour: number; minute: number };

const NAMED_TIMES: Record<string, Clock> = { noon: { hour: 12, minute: 0 }, midday: { hour: 12, minute: 0 }, midnight: { hour: 0, minute: 0 }, morning: { hour: 9, minute: 0 }, afternoon: { hour: 14, minute: 0 }, evening: { hour: 18, minute: 0 }, night: { hour: 20, minute: 0 } };

/**
 * A clock time from "9", "9:30pm", "17:00", or "morning". A bare hour from 1 to 6 could be either
 * half of the day, so it comes back as ambiguous; 7 to 11 read as morning and 12 as noon.
 */
function parseClock(s: string): Clock | "ambiguous" | null {
  const named = NAMED_TIMES[s];
  if (named) return named;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  const hour = +m[1];
  const minute = m[2] ? +m[2] : 0;
  if (hour > 23 || minute > 59) return null;
  const meridiem = m[3]?.[0];
  if (meridiem === "a") return { hour: hour === 12 ? 0 : hour, minute };
  if (meridiem === "p") return { hour: hour === 12 ? 12 : hour + 12, minute };
  if (hour >= 1 && hour <= 6) return "ambiguous";
  return { hour, minute };
}

/** The clock in a phrase's tail: "at 9", "9am", "in the morning", or nothing. */
function clockOf(tail: string): Clock | "ambiguous" | null | undefined {
  const t = tail.replace(/^(at|in the)\s+/, "").trim();
  if (!t) return undefined;
  return parseClock(t);
}

const UNIT_MINUTES: Record<string, number> = { minute: 1, minutes: 1, min: 1, mins: 1, hour: 60, hours: 60, day: 1440, days: 1440, week: 10080, weeks: 10080 };

/** The next instant at or after `from` whose zone wall clock reads the clock; `dayOffset` moves the day first. */
function nextAt(from: Date, clock: Clock, zone: string, dayOffset: number, allowNow: boolean): Date {
  const w = wallIn(from, zone);
  const base = Date.UTC(w.year, w.month - 1, w.day + dayOffset);
  const b = new Date(base);
  let at = fromWall(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate(), clock.hour, clock.minute, zone);
  if (dayOffset === 0 && !allowNow && at.getTime() <= from.getTime()) {
    const n = new Date(base + 86_400_000);
    at = fromWall(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), clock.hour, clock.minute, zone);
  }
  return at;
}

/** Days until the next occurrence of the weekday, counting today only when `todayCounts`. */
function daysUntil(from: Date, weekday: number, zone: string, todayCounts: boolean): number {
  const today = wallIn(from, zone).weekday;
  const delta = (weekday - today + 7) % 7;
  return delta === 0 && !todayCounts ? 7 : delta;
}

function done(at: Date, every: number | null, zone: string): Resolved {
  return { run_at: at.toISOString(), every_minutes: every, local: formatLocal(at.toISOString(), zone), zone };
}

/**
 * Resolves the organizer's phrase in the zone: an ISO time; "now" or "in 2 hours"; "tomorrow at 9",
 * "Friday at 9", "tonight"; or a repeat, "every morning", "every day at 8", "every 30 minutes",
 * "every Monday at 9". A phrase that names a day without a time, a bare hour that could be either
 * half of the day, or a time already past comes back as a question for the organizer.
 */
export function resolveWhen(phrase: string, zone: string, now: Date): Resolved {
  const s = phrase.trim().toLowerCase().replace(/\s+/g, " ").replace(/^(on|at)\s+/, "");
  if (!s) return { ambiguous: "When should it run?" };

  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[t ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:\d{2})?)?$/);
  if (iso) {
    if (!iso[2]) return { ambiguous: `Which time on ${iso[1]}?` };
    const at = iso[4] ? new Date(`${iso[1]}T${iso[2]}:${iso[3]}:00${iso[4].toUpperCase()}`) : fromWall(+iso[1].slice(0, 4), +iso[1].slice(5, 7), +iso[1].slice(8, 10), +iso[2], +iso[3], zone);
    if (Number.isNaN(at.getTime())) return { ambiguous: "That is not a date I can read; which day and time?" };
    return at.getTime() < now.getTime() ? { ambiguous: `${formatLocal(at.toISOString(), zone)} has passed; which time instead?` } : done(at, null, zone);
  }

  if (s === "now") return done(now, null, zone);
  const rel = s.match(/^in (\d+|an?) (minutes?|mins?|hours?|days?|weeks?)$/);
  if (rel) {
    const n = rel[1].startsWith("a") ? 1 : +rel[1];
    return done(new Date(now.getTime() + n * UNIT_MINUTES[rel[2]] * 60_000), null, zone);
  }

  const repeat = s.match(/^(?:every|each) (.+)$/) ?? (s.startsWith("daily") ? ["", `day${s.slice(5)}`] : null);
  if (repeat) return resolveRepeat(repeat[1], zone, now);

  const day = s.match(/^(today|tonight|tomorrow|this morning|this afternoon|this evening|(?:next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))(?:\s+(.*))?$/);
  if (day) {
    const tail = day[3] ?? "";
    const named = day[1] === "tonight" ? NAMED_TIMES.night : day[1].startsWith("this ") && !day[2] ? NAMED_TIMES[day[1].slice(5)] : null;
    const clock = named ?? clockOf(tail);
    if (clock === "ambiguous") return { ambiguous: `Is that ${tail.replace(/^at\s+/, "")} in the morning or the evening?` };
    if (clock === null) return { ambiguous: `Which time ${day[1]}?` };
    if (clock === undefined) return { ambiguous: `Which time on ${day[1]}?` };
    const offset = day[2] ? daysUntil(now, WEEKDAYS.indexOf(day[2]), zone, true) : day[1] === "tomorrow" ? 1 : 0;
    let at = nextAt(now, clock, zone, offset, true);
    if (day[2] && at.getTime() <= now.getTime()) at = nextAt(now, clock, zone, offset + 7, true);
    if (at.getTime() <= now.getTime()) return { ambiguous: `${formatLocal(at.toISOString(), zone)} has passed; which time instead?` };
    return done(at, null, zone);
  }

  const clock = clockOf(s);
  if (clock === "ambiguous") return { ambiguous: `Is that ${s.replace(/^at\s+/, "")} in the morning or the evening?` };
  if (!clock) return { ambiguous: `I could not read "${phrase.trim()}" as a time; which day and time?` };
  return done(nextAt(now, clock, zone, 0, false), null, zone);
}

/** The repeat forms: a unit count, a named part of each day, each day at a time, or each weekday at a time. */
function resolveRepeat(rest: string, zone: string, now: Date): Resolved {
  const units = rest.match(/^(\d+ )?(minutes?|mins?|hours?|days?|weeks?)$/);
  if (units) {
    const every = (units[1] ? +units[1] : 1) * UNIT_MINUTES[units[2]];
    if (every >= 1440) return { ambiguous: `Which time each ${units[2].replace(/s$/, "")}?` };
    return done(new Date(now.getTime() + every * 60_000), every, zone);
  }
  const daily = rest.match(/^(morning|afternoon|evening|night|day|weekday)(?:\s+(.*))?$/);
  if (daily) {
    const clock = daily[1] === "day" || daily[1] === "weekday" ? clockOf(daily[2] ?? "") : (clockOf(daily[2] ?? "") ?? NAMED_TIMES[daily[1]]);
    if (clock === "ambiguous") return { ambiguous: `Is that ${(daily[2] ?? "").replace(/^at\s+/, "")} in the morning or the evening?` };
    if (!clock) return { ambiguous: "Which time each day?" };
    return done(nextAt(now, clock, zone, 0, false), 1440, zone);
  }
  const weekly = rest.match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(.*))?$/);
  if (weekly) {
    const clock = clockOf(weekly[2] ?? "");
    if (clock === "ambiguous") return { ambiguous: `Is that ${(weekly[2] ?? "").replace(/^at\s+/, "")} in the morning or the evening?` };
    if (!clock) return { ambiguous: `Which time each ${weekly[1]}?` };
    let at = nextAt(now, clock, zone, daysUntil(now, WEEKDAYS.indexOf(weekly[1]), zone, true), true);
    if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + 7 * 86_400_000);
    return done(at, 10080, zone);
  }
  return { ambiguous: `I could not read "every ${rest}" as a repeat; how often and at what time?` };
}

/* ---- The rows ---- */

export type ScheduleInput = { action: ScheduleAction; description: string; run_at: string; gift_id?: string | null; text?: string | null; every_minutes?: number | null };

/**
 * Stores one schedule.
 *
 * Raises:
 *   BadRequestError: a message with no text, a repeat under one minute, or a run time that is not a date.
 *   NotFoundError: a gift id the event does not carry.
 */
export function createSchedule(eventId: string, input: ScheduleInput, now: Date = new Date()): Schedule {
  getEvent(eventId);
  if (Number.isNaN(Date.parse(input.run_at))) throw new BadRequestError("run_at must be an ISO 8601 time.");
  if (input.action === "message" && !input.text?.trim()) throw new BadRequestError("A message needs its text.");
  if (input.every_minutes !== undefined && input.every_minutes !== null && (!Number.isInteger(input.every_minutes) || input.every_minutes < 1)) throw new BadRequestError("every_minutes must be a whole number of minutes.");
  if (input.gift_id) requireGift(eventId, input.gift_id);
  const row: Schedule = {
    id: newId("sch"),
    event_id: eventId,
    action: input.action,
    description: input.description.trim(),
    gift_id: input.gift_id ?? null,
    text: input.text?.trim() ?? null,
    run_at: new Date(input.run_at).toISOString(),
    every_minutes: input.every_minutes ?? null,
    last_run_at: null,
    created_at: now.toISOString(),
    cancelled_at: null
  };
  state().schedules.set(row.id, row);
  return row;
}

/** The event's schedules by run time; cancelled rows only on request. */
export function listSchedules(eventId: string, includeCancelled = false): Schedule[] {
  return [...state().schedules.values()]
    .filter((s) => s.event_id === eventId && (includeCancelled || !s.cancelled_at))
    .sort((a, b) => a.run_at.localeCompare(b.run_at) || a.id.localeCompare(b.id));
}

function requireSchedule(eventId: string, scheduleId: string): Schedule {
  const row = state().schedules.get(scheduleId);
  if (!row || row.event_id !== eventId) throw new NotFoundError(`No schedule ${scheduleId} on this event.`);
  return row;
}

/**
 * Marks a schedule cancelled; the tick skips it from then on.
 *
 * Raises:
 *   NotFoundError: when the event has no such schedule.
 */
export function cancelSchedule(eventId: string, scheduleId: string, now: Date = new Date()): Schedule {
  const row = requireSchedule(eventId, scheduleId);
  const cancelled = row.cancelled_at ? row : { ...row, cancelled_at: now.toISOString() };
  state().schedules.set(row.id, cancelled);
  return cancelled;
}

/** A row is complete once a one-time run is recorded; a repeat stays live until cancelled. */
function complete(row: Schedule): boolean {
  return row.every_minutes === null && row.last_run_at !== null;
}

/** The live schedules whose run time has arrived. */
export function dueSchedules(eventId: string, now: Date = new Date()): Schedule[] {
  const at = now.getTime();
  return listSchedules(eventId).filter((s) => !complete(s) && Date.parse(s.run_at) <= at);
}

/** Records the run and moves a repeat to its next future slot, so a second tick in the same minute finds nothing due. */
function claimRun(row: Schedule, now: Date): Schedule {
  let run_at = row.run_at;
  if (row.every_minutes) {
    let next = Date.parse(row.run_at);
    while (next <= now.getTime()) next += row.every_minutes * 60_000;
    run_at = new Date(next).toISOString();
  }
  const claimed = { ...row, run_at, last_run_at: now.toISOString() };
  state().schedules.set(row.id, claimed);
  return claimed;
}

/* ---- One run ---- */

/** What a run needs from outside: the clock, the follow-up sender, the status writer, and the mailer. */
export type RunDeps = {
  now: Date;
  followUp: (eventId: string, giftId: string) => Promise<unknown>;
  /** Writes the status post for the event; the tick supplies the agent or the deterministic line. */
  status: (eventId: string) => Promise<string>;
  mailer: Mailer;
};

/** The deterministic status line: the reply counts, the open follow-ups, and each gift's cart. */
export function statusLine(eventId: string): string {
  const counts = { going: 0, maybe: 0, cant_go: 0, no_reply: 0 };
  for (const g of guestsFor(eventId)) counts[g.status] += 1;
  const parts = [`${counts.going} going, ${counts.maybe} maybe, ${counts.cant_go} not going, ${counts.no_reply} without a reply`];
  const missing = followUps(eventId).filter((f) => f.kind === "missing_value").reduce((n, f) => n + f.guest_ids.length, 0);
  if (missing) parts.push(`${missing} required ${missing === 1 ? "answer is" : "answers are"} missing`);
  const open = requestsFor(eventId).filter((r) => r.definition_ids.some((id) => isBlank(valuesFor(getGuest(r.guest_id))[id]))).length;
  if (open) parts.push(`${open} ${open === 1 ? "request is" : "requests are"} unanswered`);
  for (const gift of giftsFor(eventId)) {
    const fill = gift.cart_fill?.status;
    parts.push(`${gift.product_title || gift.product_id}: ${fill === "done" ? "the cart is ready to review" : fill === "failed" ? `the cart failed (${gift.cart_fill?.reason ?? "no reason given"})` : fill === "running" ? "the cart is filling" : gift.approved_at ? "approved" : gift.requested_at ? "values requested" : "not yet requested"}`);
  }
  return `Status: ${parts.join("; ")}.`;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * The attendees a message description names: everyone, everyone going, those without a reply, or
 * the guests whose names appear in it. An empty list means the text goes to the chat instead.
 */
export function recipientsFor(eventId: string, description: string): Guest[] {
  const d = description.toLowerCase();
  const guests = guestsFor(eventId);
  if (/\b(not|hasn't|haven't|has not|have not|no)\b.*\b(answer|answered|repl|replied|responded|response|rsvp)/.test(d) || /\bno reply\b/.test(d)) return guests.filter((g) => g.status === "no_reply");
  if (/\b(everyone|everybody|all)\b.*\b(going|attending|coming)\b/.test(d)) return guests.filter((g) => g.status === "going");
  if (/\b(everyone|everybody|all attendees|all guests|all the guests)\b/.test(d)) return guests;
  return guests.filter((g) => g.display_name && d.includes(g.display_name.toLowerCase()));
}

function partyEmail(guest: Guest): string | null {
  return state().parties.get(guest.party_id)?.contact.email ?? null;
}

async function sendMessage(event: Event, row: Schedule, deps: RunDeps): Promise<string> {
  const recipients = recipientsFor(event.id, row.description);
  const text = row.text ?? "";
  if (!recipients.length) return text;
  let sent = 0;
  let unaddressed = 0;
  for (const guest of recipients) {
    const to = partyEmail(guest);
    if (!to) {
      unaddressed += 1;
      continue;
    }
    await deps.mailer.send({ to, subject: `A message from the organizer of ${event.title}`, text: `Hello ${guest.display_name}\n\n${text}\n\nYour link:\n${attendeeLink(event, guest)}` });
    sent += 1;
  }
  const tail = unaddressed ? ` and ${unaddressed} ${unaddressed === 1 ? "attendee has" : "attendees have"} no email address` : "";
  return `Message sent to ${sent} ${sent === 1 ? "attendee" : "attendees"}${tail}: ${text}`;
}

async function sendFollowUp(eventId: string, row: Schedule, deps: RunDeps): Promise<string> {
  const before = requestsFor(eventId).reduce((n, r) => n + r.followed_up_at.length, 0);
  const gifts = row.gift_id ? [requireGift(eventId, row.gift_id)] : giftsFor(eventId).filter((g) => requestsFor(eventId, g.id).length);
  for (const gift of gifts) await deps.followUp(eventId, gift.id);
  const sent = requestsFor(eventId).reduce((n, r) => n + r.followed_up_at.length, 0) - before;
  if (!gifts.length) return "No reminder went out: no request has been sent yet.";
  if (!sent) return "No reminder went out: every request is answered.";
  const silent = followUps(eventId).find((f) => f.kind === "no_reply")?.guest_ids.length ?? 0;
  return `Reminder sent to ${sent} ${sent === 1 ? "attendee" : "attendees"}${gifts.length === 1 ? ` for ${gifts[0].product_title || gifts[0].product_id}` : ""}${silent ? `; ${silent} ${silent === 1 ? "guest has" : "guests have"} not replied to the invitation` : ""}.`;
}

/**
 * Runs one due schedule: claims the run first, so a second tick finds it moved on, then performs the
 * action and posts the outcome as a system line carrying the schedule id. A failing action posts its
 * reason instead of throwing, so one bad row never stops the others.
 */
export async function runSchedule(eventId: string, row: Schedule, deps: RunDeps): Promise<ChatMessage> {
  const event = getEvent(eventId);
  const claimed = claimRun(row, deps.now);
  let text: string;
  try {
    text = claimed.action === "status" ? await deps.status(eventId) : claimed.action === "message" ? await sendMessage(event, claimed, deps) : await sendFollowUp(eventId, claimed, deps);
  } catch (e) {
    text = `The scheduled action "${claimed.description}" failed: ${(e as Error).message}`;
  }
  return postMessage(eventId, "system", text, { schedule_id: claimed.id, at: deps.now.toISOString() });
}

/** The live dependencies of a run without the status writer, which the tick chooses. */
export function liveRunDeps(now: Date, status: RunDeps["status"]): RunDeps {
  return { now, followUp, status, mailer: mailer() };
}
