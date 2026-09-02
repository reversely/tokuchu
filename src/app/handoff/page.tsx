"use client";
import { useEffect, useState } from "react";
import { registerVendorTools } from "../../webmcp/register";

type Status = "pending" | "ready" | "unavailable";
const LABEL: Record<Status, string> = { pending: "Registering tools", ready: "Vendor tools ready", unavailable: "WebMCP unavailable in this browser" };

/**
 * The vendor's WebMCP surface: a page a vendor agent opens for one gift token, which registers the
 * vendor-scoped tools (get_manifest, get_changes, post_update, get_updates) on document.modelContext.
 * The agent reads the manifest and posts status over WebMCP here, the same way it calls the store's
 * WebMCP tools, so both sides of the handoff speak WebMCP. Query: ?event=<id>&token=<id>[&webmcp=polyfill].
 */
export default function HandoffPage() {
  const [status, setStatus] = useState<Status>("pending");
  const [tools, setTools] = useState<string[]>([]);
  const [where, setWhere] = useState<{ event: string; hasToken: boolean }>({ event: "", hasToken: false });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event") ?? "";
    const token = params.get("token") ?? "";
    setWhere({ event: eventId, hasToken: token.length > 0 });
    const controller = new AbortController();
    (async () => {
      if (!document.modelContext && params.get("webmcp") === "polyfill") {
        // @ts-expect-error polyfill.js is Chrome's script, kept verbatim and untyped.
        await import("../../webmcp/polyfill.js");
      }
      if (controller.signal.aborted) return;
      const result = await registerVendorTools({ eventId, token, signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus(result.supported ? "ready" : "unavailable");
      setTools(result.supported ? result.toolNames : []);
    })();
    return () => controller.abort();
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontFamily: "'Zilla Slab', Georgia, serif", fontSize: 28 }}>Vendor handoff</h1>
      <p style={{ color: "#51626e", marginTop: 8 }}>The vendor agent reads the manifest and posts status here over WebMCP, on <code>document.modelContext</code>.</p>
      <p style={{ marginTop: 20 }}>
        <span data-testid="handoff-status" data-status={status} style={{ display: "inline-block", padding: "6px 12px", borderRadius: 999, background: status === "ready" ? "#e7f6ee" : "#eef3f9", color: status === "ready" ? "#2f9e6b" : "#51626e", fontWeight: 600, fontSize: 14 }}>{LABEL[status]}</span>
      </p>
      <p style={{ color: "#74858f", fontSize: 14, marginTop: 12 }}>Event {where.event || "(none)"} · token {where.hasToken ? "present" : "missing"}</p>
      {tools.length > 0 && (
        <ul data-testid="handoff-tools" style={{ marginTop: 12, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, color: "#0b3d6e" }}>
          {tools.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </main>
  );
}
