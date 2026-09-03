import type { ReactNode } from "react";
import { currentCaller } from "../server/ownership";
import { SessionPill } from "./session-pill";

type Visual = { kind: "capture"; window: string; media: string; alt: string } | { kind: "diagram"; media: string; alt: string } | { kind: "compare" } | { kind: "revision" };
type Stage = { heading: string; arrows: string; tools: string[]; text: string[]; example: string; visual: Visual };

/**
 * The product flow as its features in the order the demo narration follows (docs/demo-script.md):
 * one stage per step from discovery to the order. Each stage says what the feature does and how it
 * works in the code, names the tool that carries it and the arrows of docs/diagrams/agent-sequence.mmd
 * it covers, and ends with the running example. Captures come from docs/media/guide.
 */
const STAGES: Stage[] = [
  {
    heading: "Discovery across Shopify",
    arrows: "Arrows 1 to 3",
    tools: ["search_catalog", "getTools"],
    text: [
      "A product can come from any Shopify store. Shopify's Global Catalog answers a search across every store with real products and their variants and prices and Tokuchu checks each candidate's delivery to the venue before it ranks the result. The same search covers the demo store's own catalog endpoint.",
      "Once a product page is open an agent lists the tools that page registers on document.modelContext. On a Shopify store that list holds Shopify's storefront tools and any tools the merchant adds."
    ],
    example: "Kevin searches for a personalized star map crewneck and arrives at Customworks.",
    visual: { kind: "capture", window: "Tokuchu Guest Experience", media: "/media/guide-07-search-results.webp", alt: "The ranked results with the celestial shirt from Customworks" }
  },
  {
    heading: "The customization contract",
    arrows: "Arrow 4",
    tools: ["get_customization", "set_gift_customization"],
    text: [
      "A personalized product carries a contract: the fields a unit needs with the kind of each and its limits such as a maximum length or a set of choices plus the variants the store sells. Customworks publishes that contract as a WebMCP tool on its product page so no client has to hold a field list of its own.",
      "Tokuchu stores the answer on the gift as the schema every later step reads. In managed mode Tokuchu's server opens the product page and calls the tool itself. In agent handoff mode the agent calls it on the store tab and hands the payload to Tokuchu."
    ],
    example: "The crewneck answers with a printed name and a size and a star map location.",
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-10-gift-with-customization.webp", alt: "The gift holding the fields and the variants the store returned" }
  },
  {
    heading: "Reconciliation against the RSVP list",
    arrows: "Arrows 5 to 8",
    tools: ["get_requirements", "set_personalization_mapping"],
    text: [
      "Each requirement is decided in a fixed order: an exact match on an existing field then a mapping saved for this product then a deterministic alias such as a name field for a printed name then a model's proposal for an unresolved semantic match and only then a new field. A proposal under the confidence threshold waits for the organizer to confirm. The model sees schema metadata and never attendee data and it runs only with LLM_ENABLED set.",
      "A field created for a product lives in a vendor namespace with the store and product and requirement recorded on it and its key never carries the store's name so a later product with the same concept reuses it."
    ],
    example: "The printed name maps to the attendee's preferred name and the size to a collected answer while the star map location becomes a new required field.",
    visual: { kind: "compare" }
  },
  {
    heading: "Collecting only what is missing",
    arrows: "Arrow 9",
    tools: ["request_from_attendees", "list_missing", "submit_rsvp"],
    text: [
      "A request turns each unresolved requirement into a question with the store's limit or choices and emails every going attendee who lacks an answer a link to their own reply form. A follow-up goes only to attendees whose request still has an unanswered question.",
      "The invite page registers the reply form as a WebMCP tool named submit_rsvp whose schema lists one property per question so an attendee's own agent can answer without the form."
    ],
    example: "Only the attendees with no star map location receive a request.",
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-12-request-sent.webp", alt: "The request sent with each field's source and question" }
  },
  {
    heading: "The fulfilment manifest and readiness",
    arrows: "Arrow 10",
    tools: ["get_fulfillment_manifest"],
    text: [
      "The manifest holds one row per attendee with only the values this procurement needs. Each requirement on each row carries a status: resolved or missing or invalid against the store's constraint or mapping unresolved or waiting for confirmation or rejected by the store or changed after approval. A field existing is not the same as it satisfying the contract and the grid shows the difference.",
      "The manifest also carries the cart items in the exact shape the store's cart tool takes so the last step is a copy and not a translation."
    ],
    example: "Three rows read ready once the star map locations arrive.",
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-13-records-grid.webp", alt: "The Attendees tab with the records grid graded from the fulfilment manifest" }
  },
  {
    heading: "Approval at a revision",
    arrows: "Arrow 11",
    tools: ["approve_specs", "get_changes"],
    text: [
      "Every change that affects fulfilment increments the procurement's revision: an answer arriving or a mapping edit or a schema change or an exception. Approval records the revision it applied to. A later change leaves the approved revision behind the current one and the page says so with a re-approve action.",
      "Any party can read the changes after a revision it has already seen which is how the two sides stay in step without a live connection."
    ],
    example: "Kevin approves revision 14 and the manifest carries that number.",
    visual: { kind: "revision" }
  },
  {
    heading: "Scoped access for the store",
    arrows: "The store's sequence",
    tools: ["get_procurement", "get_fulfillment_manifest", "acknowledge_changes"],
    text: [
      "An access grant names which store may read which procurement and what it may do: read the manifest or the requirements or the changes and post updates. The grant limits the attributes the store sees and can expire after fulfilment or on a date. A signed link opens a store-facing page that registers only the tools the grant allows.",
      "The store's agent reads the attendee reference and the required values for this procurement and nothing else from the RSVP list. It can record the revision it has read so the organizer sees how far the store has caught up."
    ],
    example: "Customworks receives a link and its agent reads three rows with a name and a size and a location each.",
    visual: { kind: "diagram", media: "/media/store-sequence.webp", alt: "A sequence diagram with three participants: the organizer and the store agent and the Tokuchu store page with one arrow per WebMCP call" }
  },
  {
    heading: "Exceptions and corrections",
    arrows: "The store's sequence",
    tools: ["post_procurement_update", "get_changes"],
    text: [
      "A store update is structured rather than a note: accepted or production started or fulfilled or a request for information or an invalid value or an unavailable option. A request opens an exception on the procurement and marks that attendee's requirement incomplete and emails the attendee a correction request with the store's message quoted.",
      "The attendee's corrected answer resolves the exception and moves the revision forward and the store reads the correction through the changes after the revision it last saw."
    ],
    example: "Customworks asks which Cambridge a star map is for and the attendee answers with the state and country.",
    visual: { kind: "capture", window: "Tokuchu Attendees", media: "/media/guide-19-exception.webp", alt: "The grid with the exception and the correction request" }
  },
  {
    heading: "The order",
    arrows: "Arrows 12 to 14",
    tools: ["add_customized_to_cart", "post_update", "get_order_updates"],
    text: [
      "The store's cart tool takes the manifest's cart items and adds one configured line per attendee and answers with a checkout link. Tokuchu records the link on the gift so every party can find it.",
      "After checkout the store's third tool reports the order: its financial and fulfilment status and each line with its personalization values and any tracking. Tokuchu reads it and records production started and fulfilled on the procurement and a fulfilled order ends the store's grant."
    ],
    example: "The checkout holds three crewnecks each with its own name and size and star map.",
    visual: { kind: "capture", window: "Customworks checkout", media: "/media/guide-16-store-cart.webp", alt: "The store's cart with one line per attendee" }
  }
];

/** The fourteen arrows of docs/diagrams/agent-sequence.mmd: the tool the arrow carries, the tab it lands on, and what comes back. */
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
  { tool: "post_update", on: "Tokuchu", what: "The checkout link on the gift" },
  { tool: "get_order_updates", on: "Customworks", what: "The order and its fulfilment after checkout" }
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
              <li><a href="#flow">How it works</a></li>
              <li><a href="#run">Run it</a></li>
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
              <p>Ordering customized items for an event means collecting a specification per person while the guest list is still moving and each vendor asks for different details. Tokuchu is an RSVP application and Customworks is a Shopify store and both publish their capabilities as WebMCP tools so an agent on either side of the purchase works against one order state.</p>
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
              <p>Tokuchu owns the event and its RSVP list and the procurement records. Customworks owns the products and the cart and the checkout. Each publishes what it can do as WebMCP tools on its pages and neither becomes the other's system of record.</p>
            </div>
            <div className="sites" data-testid="sites">
              <div className="card">
                <span className="eyebrow">Tokuchu</span>
                <p>The event page exposes the organizer's operations: the guest list and the gift and its requirements and the requests and the manifest and the approval. The invite page exposes one attendee operation. A store-facing page opened by a signed link exposes only the procurement operations its access grant allows.</p>
                <pre className="toolist" aria-label="Tokuchu's event page tools">{ORGANIZER_TOOLS.join("\n")}</pre>
                <pre className="toolist" aria-label="Tokuchu's store-facing page tools">{STORE_FACING_TOOLS.join("\n")}</pre>
              </div>
              <div className="card">
                <span className="eyebrow">Customworks</span>
                <p>A Shopify store built for this project that sells customized merchandise. Its product pages carry Shopify's storefront tools and three of its own: the customization contract of a product then a cart fill with one configured line per attendee then the order and its fulfilment after checkout.</p>
                <a className="shot" href="https://springbuilt.myshopify.com" target="_blank" rel="noreferrer"><img src="/media/customworks-store.webp" alt="The Customworks storefront with its banner and product offerings" loading="lazy" /></a>
                <pre className="toolist" aria-label="Customworks' merchant WebMCP tools">{["get_customization", "add_customized_to_cart", "get_order_updates"].join("\n")}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="sequence">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The sequence</span>
              <p>One agent holds Tokuchu's event page in one tab and a Customworks product page in another. Each arrow is one WebMCP call. The image predates the fourteenth arrow.</p>
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

        <section id="flow">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">How it works</span>
              <h2>Nine stages from a product to a fulfilled order.</h2>
              <p>Each stage below is a feature with the tool that carries it. The running example is Kevin who hosts an astronomy conference and orders a celestial shirt per attendee.</p>
            </div>
            <div className="story" data-testid="walkthrough">
              {STAGES.map((stage, i) => (
                <div className="story-step" data-testid="walkthrough-step" key={stage.heading}>
                  <div className="copy">
                    <div className="stepno">{i + 1}</div>
                    <span className="arrows-ref" data-testid="arrows-ref">{stage.arrows}</span>
                    <h3>{stage.heading}</h3>
                    <div className="beat-tools">{stage.tools.map((t) => <code key={t}>{t}</code>)}</div>
                    {stage.text.map((line) => <p key={line}>{line}</p>)}
                    <p className="example">{stage.example}</p>
                  </div>
                  <BeatVisual visual={stage.visual} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="run" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Run it</span>
              <p>Two runtime modes implement the same lifecycle and differ only in who crosses into the store.</p>
            </div>
            <div className="sites" data-testid="modes">
              <div className="card">
                <span className="eyebrow">Managed mode</span>
                <p>The default. The organizer uses Tokuchu's pages and Tokuchu's server searches Shopify and opens the product page to read the contract and fills the cart after approval. The store's tools are still WebMCP calls made from a headless browser.</p>
              </div>
              <div className="card">
                <span className="eyebrow">Agent handoff mode</span>
                <p>With TOKUCHU_STATIC set the server makes no store calls. A browser agent discovers the tools each page registers and chooses every call across the two tabs. The repository ships that agent as npm run agent-run on Stagehand and the OpenAI Agents SDK plus a scripted run of the same steps as the deterministic fallback.</p>
                <p className="runline"><a href={PLAYBOOK_URL} target="_blank" rel="noreferrer" data-testid="playbook-link">The agent playbook on GitHub</a></p>
              </div>
            </div>
          </div>
        </section>

        <section id="result" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The result</span>
              <p>Tokuchu consumes WebMCP from storefronts and exposes WebMCP back to authorized agents so one procurement state serves both sides.</p>
              <p>A vendor's requirements are reconciled against what the organizer already holds. Attendees are asked only for what is missing. The store reads the values it needs and nothing else and every change carries a revision that either side can read from where it left off.</p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap row">
          <span className="brand small">Tokuchu<span className="dot">.</span></span>
          <div className="links">
            <a href="#sequence">The sequence</a>
            <a href="#flow">How it works</a>
            <a href="#result">The result</a>
          </div>
          <span><span lang="ja">特注</span> personalized orders for events</span>
        </div>
      </footer>
    </div>
  );
}
