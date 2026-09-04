import type { Metadata } from "next";
import type { ReactNode } from "react";
import { currentCaller } from "../server/ownership";
import { LandingWebMcp } from "./landing-webmcp";
import { SessionPill } from "./session-pill";
import { CODEX_ENTRY_META } from "../webmcp/codex-entry";

export const metadata: Metadata = {
  other: { "tokuchu-codex-entry": CODEX_ENTRY_META }
};

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
    intent: "Read the store's customization contract instead of guessing which fields the vendor needs.",
    tokuchu: { label: "Record the product", tools: ["set_gift_plan", "set_gift_customization"] },
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
    heading: "Approve and prepare the checkout",
    audience: "For the organizer and purchasing agent",
    intent: "Review the fulfillment manifest, approve an exact revision, and convert its ready rows into configured line items. Incomplete attendees stay pending.",
    tokuchu: { label: "Scope and approve the manifest", tools: ["get_fulfillment_manifest", "approve_specs", "get_changes", "post_update"] },
    customworks: { label: "Create configured cart lines", tools: ["add_customized_to_cart"] },
    outcome: "A reviewable approval tied to a revision, plus a checkout containing one correctly configured line per complete recipient.",
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

const STAGES = [
  {
    label: "Create the event",
    message: "Use the chat browser and Tokuchu’s WebMCP tools to create the Eastern Canada Astronomy Symposium at tokuchu.onrender.com for March 18, 2027, at noon Toronto time, at the Ontario Science Centre. Add Tokuchu’s ten sample attendees."
  },
  {
    label: "Review a recommendation",
    message: "Then, open Customworks at springbuilt.myshopify.com in the chat browser and use its WebMCP tools to find a personalized apparel gift for our attendees. Show me the best option and total before creating a plan."
  },
  {
    label: "Prepare the checkout",
    message: "Use that option for everyone marked going, with each person’s name on their gift. Reuse their saved details and company wide states. Prepare one item per complete attendee, leave incomplete attendees pending, and save the checkout in Tokuchu. Tell me who’s included, who’s pending, and the total."
  }
];

function Window({ title, children }: { title: string; children: ReactNode }) {
  return <div className="window"><div className="chrome"><span className="dots"><i /><i /><i /></span><span className="ttl">{title}</span></div>{children}</div>;
}

function ToolGroup({ label, tools }: { label: string; tools: string[] }) {
  return <div className="tool-group"><span>{label}</span><div>{tools.map((tool) => <code key={tool}>{tool}</code>)}</div></div>;
}

function CopyButton({ text }: { text: string }) {
  return <button className="copy-btn" data-copy={text} aria-label="Copy message" title="Copy"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>;
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
            <ul><li><a href="#chatgpt">Browser agent</a></li><li><a href="#sites">Two websites</a></li><li><a href="#flow">Procurement flow</a></li><li><a href="#result">The result</a></li></ul>
            <a className="iconbtn" href="/events" aria-label="Your events" title="Your events" data-testid="my-events-link"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg></a>
            <a className="iconbtn primary" href={start} aria-label="Create an event" title="Create an event" data-testid="start"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></a>
            <SessionPill />
            <LandingWebMcp />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero"><div className="wrap">
          <img className="banner hero-banner" src="/media/tokuchu-banner.webp" alt="Tokuchu" data-testid="banner" />
          <h1 className="hero-headline" data-testid="intent">A WebMCP-native event workspace for managing participants, their requirements, and the purchases made on their behalf.</h1>
          <div className="sub"><p>Point a WebMCP browser agent at Tokuchu. It discovers the tools on Tokuchu and on the store, then coordinates the event, the attendee data, and the checkout across both sites.</p><p>Instead of copying guest lists between forms, spreadsheets, vendors, and storefronts, Tokuchu gives agents one source of truth for who is attending and what each person needs.</p></div>
          <div className="cta"><a className="btn primary big" href="#chatgpt" data-testid="try-chatgpt">Try with an agent</a><a className="btn ghost big" href="#demo-intro" data-testid="demo">Try the demo</a><a className="btn ghost big" href={start} data-testid="start-hero">Sign in</a></div>
        </div></section>

        <section id="chatgpt" className="agent-prompt"><div className="wrap">
          <div className="prompt-panel" data-testid="agent-prompt">
            <h2>Use Tokuchu with your WebMCP browser agent</h2>
            <p>Send these messages to a WebMCP-capable browser agent, like ChatGPT Browser, one at a time. After each response, review the result before sending the next stage.</p>
            <div className="stage-bubbles" data-testid="stage-bubbles">
              {STAGES.map((stage, i) => (
                <div className="stage-bubble" key={stage.label}>
                  <div className="stage-head"><span className="stage-number">{i + 1}</span><span className="stage-label">{stage.label}</span><CopyButton text={stage.message} /></div>
                  <p className="stage-message">{stage.message}</p>
                </div>
              ))}
            </div>
            <p className="prompt-note">No account needed. Guest events expire after 24 hours. Emails are logged, not sent.</p>
          </div>
        </div></section>

        <section id="demo-intro" className="demo-intro"><div className="wrap">
          <div className="demo-panel" data-testid="demo-intro">
            <h2>Or explore the interface directly</h2>
            <p>The demo opens a click-through version of the Tokuchu interface with a seeded event, ten sample attendees, and a guided walkthrough. Browser agents can also interact with and manipulate this interface, including its in-app chatbox.</p>
            <p className="demo-note">No account needed. Guest events expire after 24 hours. Emails are logged, not sent.</p>
            <a className="btn primary" href="/demo" data-testid="open-demo">Open the click-through demo</a>
          </div>
        </div></section>

        <section id="sites" className="tint"><div className="wrap">
          <div className="sec-head"><span className="eyebrow">Two sister websites</span><h2>Separate systems, connected through browser-visible tools.</h2><p>A WebMCP browser agent discovers available tools and coordinates actions across the websites. Each site remains responsible for its own data and publishes a small interface for the other side.</p></div>
          <div className="sister-grid" data-testid="sites">
            <article className="site-card"><img src="/media/tokuchu-banner.webp" alt="Tokuchu banner" /><h3>Tokuchu</h3><p>Maintains attendee information, requirements, readiness, approvals, and procurement records.</p></article>
            <div className="webmcp-bridge" aria-label="WebMCP communication between Tokuchu and Customworks"><span className="bridge-label">WebMCP</span><div className="bridge-call left"><code>get_customization</code><span>contract ← store</span></div><div className="bridge-call right"><code>add_customized_to_cart</code><span>manifest → store</span></div><div className="bridge-call left"><code>get_order_updates</code><span>status ← store</span></div></div>
            <article className="site-card"><img src="/media/customworks-banner.webp" alt="Customworks banner" /><h3>Customworks</h3><p>Supplies product requirements, variants, prices, and configured cart creation.</p></article>
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
          <div className="sec-head"><span className="eyebrow">How it works</span><h2>The agent discovers live page tools before calling them.</h2><p>Each page registers its tools on <code>document.modelContext</code>. The agent reads the available tools from the current page, calls them with structured input, and moves data between the two sites without hard-coded API knowledge.</p></div>
          <img className="arch-diagram" src="/media/agent-mode-architecture.svg" alt="Browser agent connecting the Tokuchu and Customworks tabs via WebMCP" data-testid="arch-diagram" />
          <div className="mode-strip" data-testid="modes"><div><strong>Managed mode</strong><span>Tokuchu&apos;s server handles store interactions through Shopify&apos;s UCP endpoints and headless browser page tools. <a href="/docs/guide">Interface guide</a></span></div><span aria-hidden="true">or</span><div><strong>Agent mode</strong><span><code>TOKUCHU_STATIC=1</code> removes server-side store operations; the agent&apos;s browser becomes the bridge. <a href="/docs/agent-mode">Developer guide</a></span></div></div>
        </div></section>

        <section id="result"><div className="wrap"><div className="result-panel"><span className="eyebrow">The result</span><h2>One procurement state, useful to both sides.</h2><p>Vendor requirements are reconciled against information the organizer already has. Missing data is collected only when necessary. Organizers approve an exact revision, vendors receive only the fulfillment fields they need, and browser agents can move the purchase forward using the live WebMCP capabilities of each site.</p></div></div></section>
      </main>

      <footer><div className="wrap row"><span className="brand small">Tokuchu<span className="dot">.</span></span><div className="links"><a href="/docs/architecture">Architecture</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div><span><span lang="ja">特注</span> personalized orders for events</span></div></footer>

      <script dangerouslySetInnerHTML={{ __html: `document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(b){navigator.clipboard.writeText(b.dataset.copy);b.classList.add("copied");setTimeout(function(){b.classList.remove("copied")},1200)}})` }} />
    </div>
  );
}
