import type { Metadata } from "next";
import { CODEX_DISCOVERY_CODE, CODEX_ENTRY_META } from "../../../webmcp/codex-entry";

export const metadata: Metadata = {
  title: "Browser agent entry · Tokuchu",
  description: "How a browser agent uses WebMCP to create and operate a Tokuchu guest event.",
  other: { "tokuchu-codex-entry": CODEX_ENTRY_META }
};

export default function CodexEntryPage() {
  return (
    <main className="docs-page">
      <nav className="docs-nav"><a className="brand" href="/">Tokuchu<span>.</span></a><a href="/">Back to overview</a></nav>
      <header className="docs-hero"><span className="eyebrow">Browser agent entry</span><h1>Discover the homepage tools before following its links.</h1><p>This page is public. No sign-in is needed. These instructions describe how a browser agent with WebMCP support (such as ChatGPT&apos;s browser or Codex) discovers and calls Tokuchu&apos;s page tools.</p></header>

      <section className="docs-section agent-guide">
        <h2>1. Use the built-in browser WebMCP capability</h2>
        <pre><code>{CODEX_DISCOVERY_CODE}</code></pre>
        <p>Reuse the returned tool handle while the page stays current. Call only tools returned by <code>fetchTools()</code>. Fetch again when the handle is stale or the page reports that its tools changed. Do not substitute Chrome desktop controls or DOM form filling when a matching WebMCP tool exists.</p>

        <h2>2. Create the event from the homepage</h2>
        <p>Discover the homepage tools before following the visible Create an event or Sign in links. Call <code>create_event</code>. It requires a title and a zoned ISO 8601 start plus a venue. It returns <code>event_id</code>, <code>url</code>, and <code>invite_url</code>.</p>
        <p>Open the exact returned <code>url</code>. Preserve its entire query string. A guest event uses the signed <code>?t=</code> token in that URL as its organizer session.</p>

        <h2>3. Handle a missing time explicitly</h2>
        <p>If the user provides only a date then ask for the local start time. If the user asked the agent to proceed without another question then use 12:00 noon at the venue as a provisional time. State that assumption and include the venue&apos;s UTC offset in <code>starts_at</code>. The dashboard displays the stored wall clock with that offset.</p>

        <h2>4. Load demonstration attendees only when requested</h2>
        <p>On the returned event page fetch a new WebMCP handle. Call <code>list_guests</code> first. When the user explicitly requested a demonstration and the list is empty call <code>load_sample_attendees</code>. It adds ten going attendees.</p>
        <p>Keep the returned attendee details for later invite calls. Three sample attendees intentionally have no location. Leave those values unanswered so the missing-information flow remains visible.</p>

        <h2>5. Separate setup from procurement</h2>
        <p>Event setup ends when the event and requested attendees exist. Procurement begins only when the user asks to find or configure a product. Do not continue into product search or cart preparation merely because those tools are available.</p>

        <h2>6. Verify before reporting completion</h2>
        <p>Read the event with <code>list_guests</code> and inspect the visible dashboard. Confirm the title and displayed zoned time plus the attendee count. Confirm that no scripted walkthrough covers the page. Stop once the requested outcome is visible.</p>

        <h2>Guest-event lifetime</h2>
        <p>A guest event requires no account and expires after 24 hours. Signing in can retain it. The explicit walkthrough starts only through <code>/demo</code> and is separate from ordinary guest ownership.</p>
      </section>
    </main>
  );
}
