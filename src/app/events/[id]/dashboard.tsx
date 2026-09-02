"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { snapshot } from "../../../server/api";
import { Overview } from "./overview";
import { Experience, type SearchReply } from "./experience";
import { Attendees } from "./attendees";
import { WebMcpProvider } from "../../webmcp-provider";
import { Tour } from "../../demo/tour";

export type Snapshot = ReturnType<typeof snapshot>;
type Tab = "overview" | "experience" | "attendees";

/** The published event's page (PRD Section 5): the band with the tabs, the status, the sign-in state, and the invite link; the sheet the tab fills. The snapshot polls every four seconds. The tour mounts only on a demo organizer's event. */
export function Dashboard({ initial, account }: { initial: Snapshot; account: ReactNode }) {
  const [snap, setSnap] = useState(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  /** The last catalog search, kept across tab switches so the ask bar can answer from it. */
  const [lastSearch, setLastSearch] = useState<SearchReply | null>(null);
  const event = snap.event;

  useEffect(() => {
    setOrigin(window.location.origin);
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/events/${event.id}`, { cache: "no-store" });
        if (res.status === 403 && snap.demo) window.location.assign("/demo");
        if (res.ok && !stop) setSnap((await res.json()) as Snapshot);
      } catch {
        // The next tick reads again.
      }
    };
    const timer = setInterval(tick, 4000);
    window.addEventListener("event:changed", tick);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener("event:changed", tick);
    };
  }, [event.id]);

  const invite = event.invite_code ? `${origin}/i/${event.invite_code}` : null;
  return (
    <>
      <header className="band">
        <a className="brand" href="/">Tokuchu</a>
        <nav className="tabs" aria-label="Sections">
          <button type="button" className={tab === "overview" ? "on" : ""} aria-current={tab === "overview" ? "page" : undefined} onClick={() => setTab("overview")} data-testid="tab-overview">Overview</button>
          <button type="button" className={tab === "experience" ? "on" : ""} aria-current={tab === "experience" ? "page" : undefined} onClick={() => setTab("experience")} data-testid="tab-experience">Guest Experience</button>
          <button type="button" className={tab === "attendees" ? "on" : ""} aria-current={tab === "attendees" ? "page" : undefined} onClick={() => setTab("attendees")} data-testid="tab-attendees">Attendees</button>
        </nav>
        <div className="right">
          <WebMcpProvider eventId={event.id} />
          <span className={`pill${event.status === "published" ? " live" : ""}`} data-testid="status">{event.status === "published" ? "Published" : "Draft"}</span>
          {invite && (
            <button className="btn ghost" type="button" onClick={() => { navigator.clipboard?.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1500); }} data-testid="copy-invite">
              {copied ? "Copied" : "Copy invite link"}
            </button>
          )}
          {account}
        </div>
      </header>
      <main className="sheet">
        {tab === "overview" ? (
          <Overview snap={snap} invite={invite} onChanged={() => window.dispatchEvent(new Event("event:changed"))} />
        ) : tab === "attendees" ? (
          <Attendees snap={snap} onChanged={() => window.dispatchEvent(new Event("event:changed"))} />
        ) : (
          <Experience snap={snap} onChanged={() => window.dispatchEvent(new Event("event:changed"))} lastSearch={lastSearch} setLastSearch={setLastSearch} />
        )}
      </main>
      {snap.demo && <Tour snap={snap} />}
    </>
  );
}
