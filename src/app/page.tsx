import { Fragment } from "react";
import type { ReactNode } from "react";
import { currentCaller } from "../server/ownership";
import { SessionPill } from "./session-pill";

type Step = { title: string; body: string[]; window: string; media: string; alt: string };

/** The walkthrough in the order the recorded demo runs (PRD Section 13); each clip is captured by scripts/capture-home-media.ts. */
const STEPS: Step[] = [
  {
    title: "Create the event.",
    body: ["The organizer fills in the details and publishes. Publishing creates the invite link attendees reply through and opens the dashboard."],
    window: "Tokuchu new event",
    media: "/media/step1-create.gif",
    alt: "Filling in the event details and publishing"
  },
  {
    title: "Describe the item and pick the product.",
    body: [
      "On the Guest Experience tab the organizer types one sentence about the item. Tokuchu searches the common Shopify catalog and the participating store's own endpoint and merges the results and ranks them against the sentence.",
      "The organizer picks the Customworks star map crewneck from the ranked results."
    ],
    window: "Tokuchu Guest Experience",
    media: "/media/step2-search-pick.gif",
    alt: "The search ranking the store's crewneck and the organizer picking it"
  },
  {
    title: "The store states what the crewneck needs and Tokuchu resolves where each value comes from.",
    body: [
      "Confirming the pick calls the store's get_customization tool on its product page. The tool answers with the fields the crewneck needs and their limits: a star map location and a time and a printed name under 20 characters.",
      "Tokuchu resolves each field against the RSVP record. The printed name is already there. The location and the time and the size are missing and become the attendee request."
    ],
    window: "Tokuchu Attendees",
    media: "/media/step3-requirements.gif",
    alt: "The requirements the store returned with the source of each value"
  },
  {
    title: "The merchant's schema becomes the attendee request.",
    body: [
      "Tokuchu turns the store's WebMCP schema directly into the attendee form. One click sends each attendee an email with a link to a form holding only the missing fields with the store's limits on each. Each reply fills a row in the records grid and the app follows up with whoever has not answered.",
      "The replies in this recording load through the RSVP API in place of email replies."
    ],
    window: "Tokuchu Attendees",
    media: "/media/step4-request-records.gif",
    alt: "The request going out and the responses filling the records grid"
  },
  {
    title: "The merchant receives one configured item per attendee.",
    body: [
      "When every row is complete the organizer approves. Tokuchu calls the store's add_customized_to_cart tool once with the completed batch and one item per attendee.",
      "The store returns its Shopify checkout with one line per attendee and the values on every line. The organizer reviews it and pays."
    ],
    window: "Customworks checkout",
    media: "/media/step5-approve-checkout.gif",
    alt: "The approval filling the store's cart and the checkout showing one line per attendee"
  }
];

const TOOLS = [
  { tool: "search_catalog", by: "Exposed by Shopify WebMCP", title: "Find candidate products", body: "Shopify's common storefront tool answers at the Global Catalog and at each store's endpoint. Tokuchu merges the results and ranks them against the organizer's sentence." },
  { tool: "get_customization", by: "Exposed by Customworks WebMCP", title: "Return the product's requirements", body: "The store's own tool returns the fields this product needs and their limits. Tokuchu resolves each field against the RSVP record and asks attendees only for what is missing." },
  { tool: "add_customized_to_cart", by: "Exposed by Customworks WebMCP", title: "Submit one configured item per attendee", body: "The store's ordering tool takes the completed batch and fills its cart with one line per attendee and returns the Shopify checkout." }
];

/** The chain the hero draws: what happens at each stage and which end exposes the capability. */
const CHAIN = [
  { stage: "Find", call: "search_catalog", by: "Shopify WebMCP", what: "Search Shopify products" },
  { stage: "Read", call: "get_customization", by: "Customworks WebMCP", what: "The store returns location and time and name under 20 and size" },
  { stage: "Collect", call: "attendee responses", by: "Tokuchu", what: "Ask each attendee only for the missing values" },
  { stage: "Order", call: "add_customized_to_cart", by: "Customworks WebMCP", what: "One configured item per attendee and the Shopify checkout" }
];

/** The demo crewneck's contract as the store returns it and the source Tokuchu resolves for each field. */
const CONTRACT = [
  { field: "Location", rule: "required", source: "ask the attendee" },
  { field: "Time", rule: "required", source: "ask the attendee" },
  { field: "Printed name", rule: "required and under 20 characters", source: "already in the RSVP" },
  { field: "Size", rule: "required", source: "ask the attendee" }
];

function Window({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="window">
      <div className="chrome"><span className="dots"><i /><i /><i /></span><span className="ttl">{title}</span></div>
      {children}
    </div>
  );
}

/** The landing page: the problem, the five-step walkthrough with a clip per step, and the three WebMCP tools (PRD Sections 1 and 3). */
export default async function Page() {
  const caller = await currentCaller();
  const start = caller ? "/events/new" : "/sign-in?next=%2Fevents%2Fnew";
  return (
    <div className="home">
      <header className="nav">
        <div className="wrap row">
          <a className="brand" href="/">Tokuchu<span className="dot">.</span></a>
          <div className="navlinks">
            <ul>
              <li><a href="#parties">Who is involved</a></li>
              <li><a href="#problem">The problem</a></li>
              <li><a href="#contract">The contract</a></li>
              <li><a href="#story">Walkthrough</a></li>
              <li><a href="#why">Why WebMCP</a></li>
              <li><a href="/events" data-testid="my-events-link">Your events</a></li>
            </ul>
            <SessionPill />
            <a className="btn primary" href={start} data-testid="start">Create an event</a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <img className="banner hero-banner" src="/media/tokuchu-banner.webp" alt="Tokuchu. Personalize gifts for your attendee list using WebMCP agents" data-testid="banner" />
            <h1>Agents work directly off an RSVP list to tailor products to attendees.</h1>
            <p className="sub">Choose a product once. Tokuchu reads the merchant's WebMCP requirements and collects the missing values from every attendee and prepares the completed order for review.</p>
            <ol className="chain" data-testid="chain">
              {CHAIN.map((c) => (
                <li key={c.stage}>
                  <span className="stage">{c.stage}</span>
                  <code>{c.call}</code>
                  <span className="by">{c.by}</span>
                  <span className="what">{c.what}</span>
                </li>
              ))}
            </ol>
            <p className="contract-line">WebMCP is the contract between Tokuchu and the storefront. Shopify exposes the common commerce capabilities. Customworks adds the product-specific requirements and the bulk customization action.</p>
            <div className="cta">
              <a className="btn primary big" href={start} data-testid="start-hero">Create an event</a>
              <a className="btn ghost big" href="/demo" data-testid="demo">Try the demo</a>
            </div>
            <p className="note"><b>Works with</b> Shopify stores over WebMCP and the GraphQL Admin API.</p>
          </div>
        </section>

        <section id="parties">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The three parties</span>
              <h2>Tokuchu starts from the RSVP list. Shopify carries the common commerce surface. Customworks adds the product's rules.</h2>
            </div>
            <div className="parties" data-testid="parties">
              <div className="card">
                <span className="eyebrow">Tokuchu</span>
                <h3>The organizer's app</h3>
                <p>Tokuchu holds the RSVP list and drives both stores' tools from a headless page. It resolves each requirement against the RSVP and collects the rest from attendees and approves the batch.</p>
                <span className="shot"><img src="/media/tokuchu-attendees.webp" alt="Tokuchu's Attendees tab during the cart fill with the tour callout naming the calls" loading="lazy" /></span>
                <pre className="toolist" aria-label="Tokuchu's page tools">{["request_from_attendees", "approve_specs", "submit_rsvp"].join("\n")}</pre>
              </div>
              <div className="card">
                <span className="eyebrow">Shopify WebMCP</span>
                <h3>Every store's commerce tools</h3>
                <p>Every Shopify storefront registers the same tools on its pages and answers the same calls at its UCP endpoint. Tokuchu uses them to find products and read variants.</p>
                <pre className="toolist" aria-label="Shopify's storefront WebMCP tools">{["search_catalog", "get_product", "show_variant", "browse_store", "get_cart", "update_cart", "cancel_cart", "proceed_to_checkout", "manage_orders", "search_shop_policies_and_faqs"].join("\n")}</pre>
              </div>
              <div className="card">
                <span className="eyebrow">Customworks WebMCP</span>
                <h3>The trial store built for this project</h3>
                <p>Customworks is a Shopify store set up for the 2026 WebMCP Challenge. Its theme registers two tools of its own beside Shopify's: one returns what a product needs to be made and one fills the cart with configured items.</p>
                <a className="shot" href="https://springbuilt.myshopify.com" target="_blank" rel="noreferrer"><img src="/media/customworks-store.webp" alt="The Customworks storefront with its banner and product offerings" loading="lazy" /></a>
                <pre className="toolist" aria-label="Customworks' merchant WebMCP tools">{["get_customization", "add_customized_to_cart"].join("\n")}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="problem" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The problem</span>
              <h2>Choosing the gift takes one decision. Personalizing 500 of them takes 500 records.</h2>
              <p>An organizer orders a crewneck showing a star map of the venue on the event date and printed with each attendee's name. The store needs a location and a time and a name and a size for every unit. The organizer asks each attendee and keeps the answers in a spreadsheet and chases whoever has not replied and re-types each row into the store's checkout. A wrong name or size costs a reprint and a late delivery.</p>
            </div>
            <div className="scale" data-testid="scale">
              <div className="card">
                <span className="eyebrow">This demo</span>
                <strong>3 attendees</strong>
                <p>Live end to end against the store and its checkout.</p>
              </div>
              <div className="card">
                <span className="eyebrow">A real event</span>
                <strong>500 attendees × 3 fields = 1,500 values</strong>
                <p>The same steps at the scale an event team works at.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="contract">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The merchant's contract</span>
              <h2>A personalized product can tell Tokuchu how to order it.</h2>
              <p>The store publishes its required fields and their limits and its ordering operation as WebMCP tools. Tokuchu reads those requirements and resolves each value against the RSVP record and asks attendees only for what is missing.</p>
            </div>
            <div className="contract" data-testid="contract">
              <div className="contract-col">
                <span className="eyebrow">Customworks returns</span>
                <ul>
                  {CONTRACT.map((r) => <li key={r.field}><span>{r.field}</span><code>{r.rule}</code></li>)}
                </ul>
              </div>
              <div className="contract-arrow" aria-hidden="true">→</div>
              <div className="contract-col">
                <span className="eyebrow">Tokuchu resolves the source</span>
                <ul>
                  {CONTRACT.map((r) => <li key={r.field}><span>{r.field}</span><code className={r.source.startsWith("already") ? "have" : "ask"}>{r.source}</code></li>)}
                </ul>
              </div>
              <div className="contract-arrow" aria-hidden="true">→</div>
              <div className="contract-col formmock" data-testid="formmock">
                <span className="eyebrow">The attendee form</span>
                <label>Your star map location<i /></label>
                <label>Time<i /></label>
                <label>Name<i /><small>12 / 20</small></label>
                <label className="chips">Size<span><b>S</b><b>M</b><b>L</b><b>XL</b></span></label>
              </div>
            </div>
          </div>
        </section>

        <section id="story">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">A walkthrough</span>
              <h2>One event from the guest list to the checkout.</h2>
              <p>These clips come from the recorded demo against the live store. The event is the 8th Annual Eastern Canada Astronomy Symposium in Toronto. Every attendee leaves with a crewneck showing a star map of the venue on the event date and printed with their name. Three attendees have replied.</p>
            </div>
            <div className="story" data-testid="walkthrough">
              {STEPS.map((step, i) => (
                <Fragment key={step.media}>
                  <div className="story-step" data-testid="walkthrough-step">
                    <div className="copy">
                      <div className="stepno">{i + 1}</div>
                      <h3>{step.title}</h3>
                      {step.body.map((line) => <p key={line}>{line}</p>)}
                    </div>
                    <Window title={step.window}>
                      <img src={step.media} alt={step.alt} loading="lazy" />
                    </Window>
                  </div>
                  {i === 1 && (
                    <div className="story-interlude" id="usecase" data-testid="usecase">
                      <img className="banner" src="/media/customworks-banner.webp" alt="Customworks. Make it your own. A Shopify storefront for the 2026 WebMCP Challenge" loading="lazy" />
                      <div className="usecase-copy">
                        <span className="eyebrow">The store in this walkthrough</span>
                        <h3>Customworks</h3>
                        <p>Customworks is the trial Shopify store created for this project. Beside Shopify's own storefront tools it exposes WebMCP functions for Tokuchu's agents to use: one that returns the customization a product needs and its limits and one that fills the cart with configured lines. The next step reads the first of them.</p>
                        <p>The same pattern supports other made-to-order products when the merchant exposes its required fields and its fulfillment action through WebMCP. Team kits and engraved awards and attendee gifts and printed merchandise follow the same path.</p>
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        <section id="why" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Why WebMCP</span>
              <h2>Shopify gives every store a common commerce surface. Customworks extends it for made-to-order work.</h2>
              <p className="why-lead">The store publishes its required fields and validation rules and its ordering operation as WebMCP tools with a name and a JSON Schema. Tokuchu works from the merchant's actual fulfillment rules instead of a hard-coded integration. Before WebMCP an app scraped the product page or built one integration per store.</p>
            </div>
            <div className="why" data-testid="tools">
              {TOOLS.map((card) => (
                <div className="card" key={card.tool}>
                  <span className="tag">{card.tool}</span>
                  <span className="by">{card.by}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
              ))}
            </div>
            <p className="whyfoot">Orders and fulfillment read back through Shopify's GraphQL Admin API. Payment happens at Shopify's checkout.</p>
          </div>
        </section>

        <section>
          <div className="wrap">
            <div className="cta-band">
              <h2>Turn the next guest list into a finished order.</h2>
              <p>Create an event and describe the item. The app reads the store's requirements and collects the values from each attendee. Approve the records and open the cart.</p>
              <div className="cta">
                <a className="btn light big" href={start}>Create an event</a>
                <a className="btn outline-light big" href="/demo">Try the demo</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap row">
          <span className="brand small">Tokuchu<span className="dot">.</span></span>
          <div className="links">
            <a href="#problem">The problem</a>
            <a href="#story">Walkthrough</a>
            <a href="#why">Why WebMCP</a>
          </div>
          <span><span lang="ja">特注</span> personalized orders for events</span>
        </div>
      </footer>
    </div>
  );
}
