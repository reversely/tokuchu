"use client";
import { useEffect, useState, type DependencyList } from "react";
import { registerTokuchuTools, type RegisterResult } from "../webmcp/register";
import { withDemoHeaders } from "../demo/token";

type Status = "pending" | "ready" | "unavailable";
const LABEL: Record<Status, string> = { pending: "Agent tools loading", ready: "Agent tools ready", unavailable: "Agent tools unavailable in this browser" };

/** The polyfill is opt-in: `?webmcp=polyfill` on the URL, or NEXT_PUBLIC_WEBMCP_POLYFILL=1 at build time. */
function wantsPolyfill(): boolean {
  if (process.env.NEXT_PUBLIC_WEBMCP_POLYFILL === "1") return true;
  return new URLSearchParams(window.location.search).get("webmcp") === "polyfill";
}

/** A write through a tool changes the event; the dashboard listens for this event and re-reads the snapshot. A demo page's token goes out as the demo header. */
function notifyingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, withDemoHeaders(init)).then((response) => {
    if (response.ok && init?.method && init.method !== "GET") window.dispatchEvent(new Event("event:changed"));
    return response;
  });
}

/** Loads the polyfill when asked, runs `register` while the page is mounted, and reports whether an agent can see the tools. */
export function useWebMcp(register: (signal: AbortSignal) => Promise<RegisterResult>, deps: DependencyList): Status {
  const [status, setStatus] = useState<Status>("pending");
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!document.modelContext && wantsPolyfill()) {
        // @ts-expect-error polyfill.js is Chrome's script, kept verbatim and untyped.
        await import("../webmcp/polyfill.js");
      }
      if (controller.signal.aborted) return;
      const result = await register(controller.signal);
      if (!controller.signal.aborted) setStatus(result.supported ? "ready" : "unavailable");
    })();
    return () => controller.abort();
    // The caller's deps name what the registration reads, the same way they would for the effect itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return status;
}

export function WebMcpPill({ status }: { status: Status }) {
  return (
    <span className={`pill${status === "ready" ? " live" : ""}`} data-testid="webmcp-status" data-status={status} aria-live="polite">
      {LABEL[status]}
    </span>
  );
}

/** Registers the organizer-scoped tools while the dashboard is mounted (PRD Section 7) and shows whether an agent can see them. */
export function WebMcpProvider({ eventId }: { eventId: string }) {
  const status = useWebMcp((signal) => registerTokuchuTools({ eventId, fetchImpl: notifyingFetch, signal }), [eventId]);
  return <WebMcpPill status={status} />;
}
