import type { ReactNode } from "react";
import { currentCaller } from "../server/ownership";
import { SessionPill } from "./session-pill";

type Visual = { kind: "capture"; window: string; media: string; alt: string } | { kind: "diagram"; media: string; alt: string } | { kind: "compare" } | { kind: "revision" };
type Beat = { arrows: string; tools: string[]; text: string[]; visual: Visual };

/**
 * The story in the demo narration's order and words (docs/demo-script.md), one beat per paragraph
 * from the search to the checkout. Each beat names the tool it runs and the arrows of
 * docs/diagrams/agent-sequence.mmd it covers, and shows the matching capture or a small diagram.
 * The clips come from scripts/capture-home-media.ts and the store-side captures from docs/guide.md.
 */
const BEATS: Beat[] = [
  {
    arrows: "Arrow 3",
    tools: ["search_catalog"],
    text: ["Kevin uses Shopify's Global Catalog to find a suitable product and arrives at Customworks."],
    visual: { kind: "capture", window: "Tokuchu Guest Experience", media: "/media/guide-07-search-results.webp", alt: "The ranked results with the celestial shirt from Customworks" }
  },
  {
    arrows: "Arrow 4",
    tools: ["get_customization"],
    text: ["The celestial shirt exposes a custom WebMCP function called get_customization. It tells the agent that each shirt requires a printed name and a shirt size and a location for the star map."],
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-10-gift-with-customization.webp", alt: "The gift holding the fields and the variants the store returned" }
  },
  {
    arrows: "Arrows 5 to 9",
    tools: ["set_gift_customization", "get_requirements", "request_from_attendees"],
    text: [
      "Tokuchu's agent compares those requirements against Kevin's RSVP data.",
      "It already has each attendee's preferred name so that requirement can be mapped directly. If shirt size has already been collected Tokuchu can reuse that as well. But it does not have a star-map location so Tokuchu creates that as a new required attendee field and requests the missing information from the relevant participants."
    ],
    visual: { kind: "compare" }
  },
  {
    arrows: "Arrow 10",
    tools: ["get_fulfillment_manifest"],
    text: ["Once those responses come back Tokuchu validates the data and assembles a fulfillment manifest containing only the information required for this procurement."],
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-13-records-grid.webp", alt: "The Attendees tab with the records grid graded from the fulfillment manifest" }
  },
  {
    arrows: "Arrow 11",
    tools: ["approve_specs"],
    text: ["Kevin can review and approve that exact revision of the order."],
    visual: { kind: "revision" }
  },
  {
    arrows: "The store's sequence",
    tools: ["get_fulfillment_manifest"],
    text: ["Customworks can then be given scoped access to the procurement. Its own agent can call Tokuchu's WebMCP tools to retrieve the approved fulfillment manifest without gaining access to unrelated RSVP information."],
    visual: { kind: "diagram", media: "/media/store-sequence.webp", alt: "A sequence diagram with three participants: the organizer and the store agent and the Tokuchu store page with one arrow per WebMCP call" }
  },
  {
    arrows: "The store's sequence",
    tools: ["post_procurement_update", "get_changes"],
    text: [
      "If something changes that shared state can change with it. For example if a vendor determines that an attendee's star-map location is too ambiguous its agent can submit a structured request for clarification.",
      "Tokuchu records the exception and routes it back to the attendee and exposes the corrected value in the next revision."
    ],
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-19-exception.webp", alt: "The grid with the exception and the correction request" }
  },
  {
    arrows: "Arrows 12 and 13",
    tools: ["add_customized_to_cart", "post_update"],
    text: ["Once the fulfillment data is complete Kevin's agent can use Shopify's native WebMCP tools to place the configured items into the cart and continue through checkout."],
    visual: { kind: "capture", window: "Customworks checkout", media: "/media/guide-16-store-cart.webp", alt: "The store's cart with one line per attendee" }
  }
];

/** The thirteen arrows of docs/diagrams/agent-sequence.mmd: the tool the arrow carries, the tab it lands on, and what comes back. */
const SEQUENCE = [
  { tool: "getTools", on: "Tokuchu", what: "The event page lists its tools" },
  { tool: "list_guests", on: "Tokuchu", what: "Every attendee who has replied going" },
  { tool: "getTools", on: "Customworks", what: "The product page lists its tools" },
  { tool: "get_customization", on: "Customworks", what: "The product's fields and their limits" },
  { tool: "compare", on: "Agent", what: "What the RSVP list already fills" },
  { tool: "set_gift_plan", on: "Tokuchu", what: "A gift for the store's product" },
  { tool: "set_gift_customization", on: "Tokuchu", what: "The store's payload becomes the schema" },
  { tool: "get_requirements then request_from_attendees", on: "Tokuchu", what: "Each field's source then the requests" },
  { tool: "list_missing", on: "Tokuchu", what: "The attendees still owing an answer" },
  { tool: "get_fulfillment_manifest", on: "Tokuchu", what: "Each row graded until all ready" },
  { tool: "approve_specs", on: "Tokuchu", what: "The approval recorded at a revision" },
  { tool: "add_customized_to_cart", on: "Customworks", what: "One line per attendee plus checkout" },
  { tool: "post_update", on: "Tokuchu", what: "The checkout link on the gift" }
];

/** The comparison beat drawn small: each requirement the shirt states and what Tokuchu's RSVP data holds for it. */
const COMPARE = [
  { field: "printed name", held: "the attendee's preferred name", outcome: "mapped directly", state: "have" },
  { field: "shirt size", held: "collected already", outcome: "reused", state: "have" },
  { field: "star-map location", held: "not in the RSVP data", outcome: "a new required attendee field", state: "ask" }
];

const ORGANIZER_TOOLS = ["list_guests", "set_gift_plan", "set_gift_customization", "get_requirements", "request_from_attendees", "list_missing", "get_fulfillment_manifest", "approve_specs"];
const STORE_FACING_TOOLS = ["get_procurement", "get_fulfillment_manifest", "get_requirements", "get_changes", "acknowledge_changes", "get_updates", "post_procurement_update"];

const PLAYBOOK_URL = "https://github.com/reversely/tokuchu/blob/main/docs/agent-playbook.md";

function Window({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="window">
      <div className="chrome"><span className="dots"><i /><i /><i /></span><span className="ttl">{title}</span></div>
      {children}
    </div>
  );
}

function BeatVisual({ visual }: { visual: Visual }) {
  switch (visual.kind) {
    case "capture":
      return <Window title={visual.window}><img src={visual.media} alt={visual.alt} loading="lazy" /></Window>;
    case "diagram":
      return <div className="diagram"><img src={visual.media} alt={visual.alt} loading="lazy" /></div>;
    case "compare":
      return (
        <ul className="compare" data-testid="compare" aria-label="The requirements compared with the RSVP data">
          {COMPARE.map((r) => (
            <li key={r.field}>
              <span className="field">{r.field}</span>
              <span className={`held ${r.state}`}>{r.held}</span>
              <span className="outcome">{r.outcome}</span>
            </li>
          ))}
        </ul>
      );
    case "revision":
      return (
        <ol className="revisions" data-testid="revisions" aria-label="The order's revisions">
          <li><span className="rev">revision N-1</span><span className="mark">an earlier revision</span></li>
          <li className="approved"><span className="rev">revision N</span><span className="mark">approved</span></li>
          <li><span className="rev">revision N+1</span><span className="mark">a later revision</span></li>
        </ol>
      );
  }
}

/** The landing page in the demo narration's order (docs/demo-script.md): the intent in the hero, the two websites, the sequence, Kevin's story beat by beat, and the closing paragraphs. */
export default async function Page() {
  const caller = await currentCaller();
  // A visitor with no account and a guest both go through sign-in; a first sign-in creates the account.
  const start = caller && !caller.is_demo ? "/events/new" : "/sign-in?next=%2Fevents%2Fnew";
  return (
    <div className="home">
      <header className="nav">
        <div className="wrap row">
          <a className="brand" href="/">Tokuchu<span className="dot">.</span></a>
          <div className="navlinks">
            <ul>
              <li><a href="#sites">Two websites</a></li>
              <li><a href="#sequence">The sequence</a></li>
              <li><a href="#story">The story</a></li>
              <li><a href="#result">The result</a></li>
            </ul>
            <a className="iconbtn" href="/events" aria-label="Your events" title="Your events" data-testid="my-events-link">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            </a>
            <a className="iconbtn primary" href={start} aria-label="Create an event" title="Create an event" data-testid="start">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </a>
            <SessionPill />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <img className="banner hero-banner" src="/media/tokuchu-banner.webp" alt="Tokuchu. Personalize gifts for your attendee list using WebMCP agents" data-testid="banner" />
            <div className="sub" data-testid="intent">
              <p>Event organizers often request customizations from dietary restrictions to names printed on party favours.</p>
              <p>But the specifications for these customizations can be difficult to collect. Organizers may not yet know exactly who is attending or what each guest needs or which details a vendor requires. That creates a lot of manual back and forth.</p>
              <p>Agents can help coordinate this information if there is an intermediate source of truth that can both consume requirements from e-commerce sites and expose the resulting fulfillment data back to other agents through WebMCP.</p>
            </div>
            <div className="cta">
              <a className="btn primary big" href={start} data-testid="start-hero">Create an event</a>
              <a className="btn ghost big" href="/demo" data-testid="demo">Try the demo</a>
            </div>
          </div>
        </section>

        <section id="sites" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Two websites</span>
              <p>To explore this the project's author created a pair of websites: an RSVP application called Tokuchu and a Shopify store called Customworks. Both expose custom WebMCP functions. Agents on either side of a purchase work against the same evolving order state.</p>
            </div>
            <div className="sites" data-testid="sites">
              <div className="card">
                <span className="eyebrow">Tokuchu</span>
                <p>Tokuchu helps event organizers collect RSVP information and use that attendee data when making purchasing decisions. It can call WebMCP tools exposed by storefronts. It can reconcile their customization requirements against information it already has. It can request anything that is still missing. It can expose a scoped fulfillment view back to an authorized vendor.</p>
                <pre className="toolist" aria-label="Tokuchu's event page tools">{ORGANIZER_TOOLS.join("\n")}</pre>
                <pre className="toolist" aria-label="Tokuchu's store-facing page tools">{STORE_FACING_TOOLS.join("\n")}</pre>
              </div>
              <div className="card">
                <span className="eyebrow">Customworks</span>
                <p>Customworks sells dropshipped customized merchandise. Its WebMCP tools describe what information each product needs for personalization and can return updates about the resulting order.</p>
                <a className="shot" href="https://springbuilt.myshopify.com" target="_blank" rel="noreferrer"><img src="/media/customworks-store.webp" alt="The Customworks storefront with its banner and product offerings" loading="lazy" /></a>
                <pre className="toolist" aria-label="Customworks' merchant WebMCP tools">{["get_customization", "add_customized_to_cart"].join("\n")}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="sequence">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The sequence</span>
              <p>One agent holds Tokuchu's event page in one tab and a Customworks product page in another. Each arrow is one WebMCP call.</p>
            </div>
            <div className="sequence" data-testid="sequence">
              <div className="diagram">
                <img src="/media/agent-sequence.webp" alt="A sequence diagram with three participants: a browser agent and a Tokuchu tab and a Customworks tab with one arrow per WebMCP call" />
              </div>
              <ol className="arrows" data-testid="arrows">
                {SEQUENCE.map((a, i) => (
                  <li key={`${i}-${a.tool}`}>
                    <span className="no">{i + 1}</span>
                    <span className="arrow-body">
                      <code>{a.tool}</code>
                      <span className={`on on-${a.on.toLowerCase()}`}>{a.on}</span>
                      <span className="what">{a.what}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="story">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The story</span>
              <h2>Let's say Kevin is hosting an astronomy conference and wants to send participants customized celestial shirts.</h2>
            </div>
            <div className="story" data-testid="walkthrough">
              {BEATS.map((beat, i) => (
                <div className="story-step" data-testid="walkthrough-step" key={beat.text[0]}>
                  <div className="copy">
                    <div className="stepno">{i + 1}</div>
                    <span className="arrows-ref" data-testid="arrows-ref">{beat.arrows}</span>
                    <div className="beat-tools">{beat.tools.map((t) => <code key={t}>{t}</code>)}</div>
                    {beat.text.map((line) => <p key={line}>{line}</p>)}
                  </div>
                  <BeatVisual visual={beat.visual} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="result" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The result</span>
              <p>Throughout the demo Tokuchu is both consuming WebMCP from storefronts and exposing WebMCP back to other authorized agents.</p>
              <p>The result is a shared source of truth for customized procurement. Vendor requirements can be reconciled against information the organizer already has. Missing data can be collected only when necessary. Each party's agent can access the specific information it needs to move the order forward.</p>
            </div>
            <p className="runline"><a href={PLAYBOOK_URL} target="_blank" rel="noreferrer" data-testid="playbook-link">Run it from the agent playbook on GitHub</a></p>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap row">
          <span className="brand small">Tokuchu<span className="dot">.</span></span>
          <div className="links">
            <a href="#sequence">The sequence</a>
            <a href="#story">The story</a>
            <a href="#result">The result</a>
          </div>
          <span><span lang="ja">特注</span> personalized orders for events</span>
        </div>
      </footer>
    </div>
  );
}
