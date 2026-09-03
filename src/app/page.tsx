import type { ReactNode } from "react";
import { currentCaller } from "../server/ownership";
import { SessionPill } from "./session-pill";

type Utility = {
  heading: string;
  audience: string;
  intent: string;
  tokuchu: { label: string; tools: string[] };
  customworks: { label: string; tools: string[] };
  outcome: string;
  media: string;
  alt: string;
};

const UTILITIES: Utility[] = [
  {
    heading: "Understand the product before collecting data",
    audience: "For the organizer and purchasing agent",
    intent: "Discover a suitable product, then read its customization contract instead of guessing which fields the vendor needs.",
    tokuchu: { label: "Find and record the product", tools: ["search_gifts", "set_gift_plan", "set_gift_customization"] },
    customworks: { label: "Publish the product contract", tools: ["get_customization"] },
    outcome: "A procurement whose required fields, constraints, variants, and product identity come from the storefront.",
    media: "/media/guide-10-gift-with-customization.webp",
    alt: "A Tokuchu procurement showing customization fields received from a storefront"
  },
  {
    heading: "Turn requirements into attendee-ready data",
    audience: "For the organizer and attendees",
    intent: "Reconcile the vendor contract with RSVP fields already held by Tokuchu, then ask only the people and questions that remain unresolved.",
    tokuchu: { label: "Map, request, validate", tools: ["get_requirements", "set_personalization_mapping", "request_from_attendees", "list_missing", "submit_rsvp"] },
    customworks: { label: "Define valid values", tools: ["get_customization"] },
    outcome: "One fulfillment row per recipient, with every required value marked ready, missing, invalid, or awaiting a decision.",
    media: "/media/guide-13-records-grid.webp",
    alt: "The attendee fulfillment grid with requirement readiness states"
  },
  {
    heading: "Approve a stable fulfillment revision",
    audience: "For the organizer and purchasing agent",
    intent: "Review the minimum vendor-facing manifest, approve an exact revision, and convert its cart-ready rows into configured line items.",
    tokuchu: { label: "Scope and approve the manifest", tools: ["get_fulfillment_manifest", "approve_specs", "get_changes", "post_update"] },
    customworks: { label: "Create configured cart lines", tools: ["add_customized_to_cart"] },
    outcome: "A reviewable approval tied to a revision, plus a checkout containing one correctly configured line per recipient.",
    media: "/media/guide-16-store-cart.webp",
    alt: "A Customworks cart containing configured items for multiple recipients"
  },
  {
    heading: "Keep fulfillment synchronized after handoff",
    audience: "For the vendor and organizer",
    intent: "Give the vendor a scoped view of the approved procurement and carry structured exceptions, corrections, production state, and order updates in both directions.",
    tokuchu: { label: "Expose only authorized order state", tools: ["get_procurement", "get_fulfillment_manifest", "get_changes", "acknowledge_changes", "post_procurement_update"] },
    customworks: { label: "Report order progress", tools: ["get_order_updates"] },
    outcome: "A shared, revisioned source of truth without exposing unrelated RSVP information to the vendor.",
    media: "/media/guide-19-exception.webp",
    alt: "A structured vendor exception routed into the attendee fulfillment grid"
  }
];

const PLAYBOOK_URL = "https://github.com/reversely/tokuchu/blob/main/docs/agent-runtime.md";

function Window({ title, children }: { title: string; children: ReactNode }) {
  return <div className="window"><div className="chrome"><span className="dots"><i /><i /><i /></span><span className="ttl">{title}</span></div>{children}</div>;
}

function ToolGroup({ label, tools }: { label: string; tools: string[] }) {
  return <div className="tool-group"><span>{label}</span><div>{tools.map((tool) => <code key={tool}>{tool}</code>)}</div></div>;
}

export default async function Page() {
  const caller = await currentCaller();
  const start = caller && !caller.is_demo ? "/events/new" : "/sign-in?next=%2Fevents%2Fnew";

  return (
    <div className="home">
      <header className="nav">
        <div className="wrap row">
          <a className="brand" href="/">Tokuchu<span className="dot">.</span></a>
          <div className="navlinks">
            <ul><li><a href="#sites">Two websites</a></li><li><a href="#flow">Procurement flow</a></li><li><a href="#runtime">Browser agents</a></li><li><a href="#result">The result</a></li></ul>
            <a className="iconbtn" href="/events" aria-label="Your events" title="Your events" data-testid="my-events-link"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg></a>
            <a className="iconbtn primary" href={start} aria-label="Create an event" title="Create an event" data-testid="start"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></a>
            <SessionPill />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero"><div className="wrap">
          <img className="banner hero-banner" src="/media/tokuchu-banner.webp" alt="Tokuchu. Personalize gifts for your attendee list using WebMCP agents" data-testid="banner" />
          <div className="sub" data-testid="intent"><p>Customized procurement is a coordination problem: a vendor defines what each item requires while an organizer holds changing information about who will receive it. Tokuchu and Customworks let browser agents work across that boundary through WebMCP, using one evolving procurement state.</p></div>
          <div className="cta"><a className="btn primary big" href={start} data-testid="start-hero">Create an event</a><a className="btn ghost big" href="/demo" data-testid="demo">Try the demo</a></div>
        </div></section>

        <section id="sites" className="tint"><div className="wrap">
          <div className="sec-head"><span className="eyebrow">Two sister websites</span><h2>Separate systems, connected through browser-visible tools.</h2><p>Each site remains responsible for its own data and publishes a small interface for the other side. The center column shows the three WebMCP calls that carry the purchase across the boundary.</p></div>
          <div className="sister-grid" data-testid="sites">
            <article className="site-card"><img src="/media/tokuchu-banner.webp" alt="Tokuchu banner" /><h3>Tokuchu: RSVP Application with Attendee States</h3><p>Holds attendance, reusable attendee fields, missing-data requests, readiness, approvals, revisions, and the vendor-scoped fulfillment manifest.</p></article>
            <div className="webmcp-bridge" aria-label="WebMCP communication between Tokuchu and Customworks"><span className="bridge-label">WebMCP</span><div className="bridge-call left"><code>get_customization</code><span>contract ← store</span></div><div className="bridge-call right"><code>add_customized_to_cart</code><span>manifest → store</span></div><div className="bridge-call left"><code>get_order_updates</code><span>status ← store</span></div></div>
            <article className="site-card"><img src="/media/customworks-banner.webp" alt="Customworks banner" /><h3>Customworks: Shopify Store with WebMCP-enabled Customization</h3><p>Owns products, personalization constraints, configured cart lines, checkout, and the resulting financial and fulfillment status.</p></article>
          </div>
        </div></section>

        <section id="flow"><div className="wrap">
          <div className="sec-head"><span className="eyebrow">Procurement flow</span><h2>Four utilities, organized by the job they do.</h2><p>The individual WebMCP functions sit inside broader capabilities for organizers, attendees, vendors, and the agents acting for them.</p></div>
          <div className="utility-flow" data-testid="walkthrough">{UTILITIES.map((utility, index) => (
            <article className="utility" data-testid="walkthrough-step" key={utility.heading}>
              <div className="utility-copy"><div className="utility-kicker"><span>{index + 1}</span>{utility.audience}</div><h3>{utility.heading}</h3><p className="utility-intent">{utility.intent}</p><div className="utility-tools"><ToolGroup label={`Tokuchu · ${utility.tokuchu.label}`} tools={utility.tokuchu.tools} /><ToolGroup label={`Customworks · ${utility.customworks.label}`} tools={utility.customworks.tools} /></div><p className="utility-outcome"><strong>Outcome</strong>{utility.outcome}</p></div>
              <Window title={index < 2 ? "Tokuchu attendee state" : index === 2 ? "Customworks configured cart" : "Tokuchu vendor exception"}><img src={utility.media} alt={utility.alt} loading="lazy" /></Window>
            </article>
          ))}</div>
        </div></section>

        <section id="runtime" className="tint"><div className="wrap">
          <div className="sec-head"><span className="eyebrow">Stagehand browser-agent architecture</span><h2>The agent operates the browser; Stagehand exposes each page&apos;s WebMCP surface.</h2><p>In agent handoff mode, Tokuchu does not make server-side storefront calls. The agent owns the cross-site work and discovers the current tools from the active page at runtime.</p></div>
          <div className="runtime-flow" data-testid="stagehand-runtime">
            <div className="runtime-node"><span>1 · Intent</span><strong>Goal + operating playbook</strong><p>Defines the procurement outcome and safety rules, not a fixed business-call script.</p></div><span className="runtime-arrow" aria-hidden="true">→</span>
            <div className="runtime-node"><span>2 · Reasoning</span><strong>OpenAI Agents SDK</strong><p>Chooses the next tab and tool from schemas, results, and the evolving order state.</p></div><span className="runtime-arrow" aria-hidden="true">→</span>
            <div className="runtime-node accent"><span>3 · Browser</span><strong>Stagehand</strong><p>Wraps the Chrome context, preserves both tabs, and gives the runtime access to <code>Page.tools()</code>.</p></div><span className="runtime-arrow" aria-hidden="true">→</span>
            <div className="runtime-node"><span>4 · Page capabilities</span><strong>Native WebMCP</strong><p>Tokuchu and Customworks register tools on <code>document.modelContext</code>; Stagehand returns their schemas and frame IDs.</p></div>
          </div>
          <div className="runtime-detail">
            <article><span className="eyebrow">Five generic browser controls</span><p>The model receives only <code>open_page</code>, <code>list_webmcp_tools</code>, <code>call_webmcp_tool</code>, <code>switch_tab</code>, and <code>record_checkout</code>. Product-specific operations are discovered from the two websites rather than hard-coded into the agent runtime.</p></article>
            <article><span className="eyebrow">Discovery and invocation</span><p><code>list_webmcp_tools</code> calls Stagehand&apos;s <code>Page.tools()</code> and returns each tool&apos;s name, description, input schema, and frame. <code>call_webmcp_tool</code> resolves that page tool, invokes it with structured input, waits for completion, and normalizes WebMCP content and errors for the model.</p></article>
            <article><span className="eyebrow">Tabs, checkout, and traceability</span><p>Stagehand keeps the Tokuchu and Customworks pages in one browser context. The runtime tracks active tabs, captures the checkout URL without returning it to the model, records it through Tokuchu&apos;s <code>post_update</code>, and writes every call, result, and final outcome to a transcript.</p></article>
          </div>
          <div className="mode-strip" data-testid="modes"><div><strong>Managed mode</strong><span>Tokuchu&apos;s server makes storefront WebMCP calls.</span></div><span aria-hidden="true">or</span><div><strong>Agent handoff mode</strong><span><code>TOKUCHU_STATIC=1</code> removes server-side store operations; Stagehand becomes the browser bridge.</span></div></div>
          <p className="runline"><a href={PLAYBOOK_URL} target="_blank" rel="noreferrer" data-testid="playbook-link">Read the browser-agent operating playbook</a></p>
        </div></section>

        <section id="result"><div className="wrap"><div className="result-panel"><span className="eyebrow">The result</span><h2>One procurement state, useful to both sides.</h2><p>Vendor requirements are reconciled against information the organizer already has. Missing data is collected only when necessary. Organizers approve an exact revision, vendors receive only the fulfillment fields they need, and browser agents can move the purchase forward using the live WebMCP capabilities of each site.</p></div></div></section>
      </main>

      <footer><div className="wrap row"><span className="brand small">Tokuchu<span className="dot">.</span></span><div className="links"><a href="#sites">Two websites</a><a href="#flow">Procurement flow</a><a href="#runtime">Browser agents</a></div><span><span lang="ja">特注</span> personalized orders for events</span></div></footer>
    </div>
  );
}
