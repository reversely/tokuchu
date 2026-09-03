import { Fragment } from "react";
import type { ReactNode } from "react";
import { currentCaller } from "../server/ownership";
import { SessionPill } from "./session-pill";

type Step = { title: string; body: string[]; window: string; media: string; alt: string };

/**
 * The walkthrough in the order the recorded demo and the acceptance run play (PRD Section 15): the
 * first five clips come from scripts/capture-home-media.ts and the four store-side captures from the
 * guide (docs/guide.md sections 12 to 15).
 */
const STEPS: Step[] = [
  {
    title: "The organizer publishes the event and the RSVP list fills.",
    body: ["The organizer fills in the details and publishes. Publishing creates the invite link attendees reply through. Each reply becomes a row the agent reads with list_guests and the list stays the source of truth for every value that follows."],
    window: "Tokuchu new event",
    media: "/media/step1-create.gif",
    alt: "Filling in the event details and publishing"
  },
  {
    title: "The agent finds the product.",
    body: [
      "Shopify's search_catalog answers on every storefront page and at the Global Catalog endpoint. Tokuchu's Guest Experience tab runs the same call for an organizer who types a sentence and ranks the results against it. An agent can call the tool on the store's page instead.",
      "The product in this walkthrough is the Customworks star map crewneck."
    ],
    window: "Tokuchu Guest Experience",
    media: "/media/step2-search-pick.gif",
    alt: "The search ranking the store's crewneck and the organizer picking it"
  },
  {
    title: "The agent reads the store's contract and hands it to Tokuchu.",
    body: [
      "On the store's product page the agent calls get_customization. The tool answers with the fields the crewneck needs and their limits: a star map location and a time and a printed name under 20 characters and the size variants.",
      "On Tokuchu's event page the agent calls set_gift_plan and then set_gift_customization with that payload. Tokuchu maps each field to a source: the printed name comes from the RSVP record and the location and the time and the size become questions."
    ],
    window: "Tokuchu Attendees",
    media: "/media/step3-requirements.gif",
    alt: "The requirements the store returned with the source of each value"
  },
  {
    title: "Tokuchu asks each attendee only for what the list lacks.",
    body: [
      "The agent calls request_from_attendees. Tokuchu turns each open field into a question with the store's limit or choices and emails every going attendee who lacks an answer a link to a form holding only those fields. An attendee's own agent answers on the invite page through submit_rsvp with the same limits in its schema.",
      "list_missing names who still owes which value. The replies in this recording load through the RSVP API in place of email replies."
    ],
    window: "Tokuchu Attendees",
    media: "/media/step4-request-records.gif",
    alt: "The request going out and the responses filling the records grid"
  },
  {
    title: "The agent approves at a revision and fills the store's cart.",
    body: [
      "When get_fulfillment_manifest grades every row ready the agent calls approve_specs. The approval records the change-log revision it stands at. The agent takes the manifest's cart_items back to the store's page and calls add_customized_to_cart once with one item per attendee and an idempotency key.",
      "The store returns its Shopify checkout with one line per attendee and the values on every line. The organizer reviews it and pays."
    ],
    window: "Customworks checkout",
    media: "/media/step5-approve-checkout.gif",
    alt: "The approval filling the store's cart and the checkout showing one line per attendee"
  },
  {
    title: "The organizer shares the fulfilment data through a signed link.",
    body: [
      "Share fulfilment data on the Attendees tab creates an access grant for the store: which attendee fields it may read and whether it may read the manifest and the change log and post updates. Access ends when the store posts fulfilled or on a date the organizer picks.",
      "Copy access link copies a signed link. The link stands in for a store account and Revoke ends it at once."
    ],
    window: "Tokuchu Attendees",
    media: "/media/guide-17-store-access.webp",
    alt: "The Share fulfilment data block with the grant just created"
  },
  {
    title: "The store's agent reads the manifest at the approved revision.",
    body: [
      "The signed link opens Tokuchu's store-facing page. It registers the grant's tools on document.modelContext: get_procurement and get_fulfillment_manifest and get_requirements and get_changes and acknowledge_changes and get_updates and post_procurement_update.",
      "The manifest carries one row per attendee with the attendee reference and the values keyed by the store's own requirement keys. No email address and no answer outside the grant leaves Tokuchu."
    ],
    window: "Tokuchu store page",
    media: "/media/guide-18-store-manifest.webp",
    alt: "The store-facing page with the manifest"
  },
  {
    title: "The store posts an exception on a value it cannot use.",
    body: [
      "One attendee gave Cambridge for the star map location. The store's agent calls post_procurement_update with needs_information and the attendee reference and the requirement and a question.",
      "The post opens an exception on the procurement and moves its revision on. The attendee's cell on the organizer's grid reads missing with the store's question under it and the attendee receives an email with the question quoted and a link to the reply form."
    ],
    window: "Tokuchu Attendees",
    media: "/media/guide-19-exception.webp",
    alt: "The grid with the exception and the correction request"
  },
  {
    title: "The correction resolves the exception and the store reads the change.",
    body: [
      "The attendee saves the full place name. The answer resolves the exception and the cell reads changed after approval because the approval stands at the earlier revision. The store's agent calls get_changes with the revision it last read and receives the exception and the answer and the resolution with a revision on each.",
      "Re-approve records the approval at the new revision and add_customized_to_cart fills the store's cart with the corrected line and returns a fresh checkout link."
    ],
    window: "Tokuchu Attendees",
    media: "/media/guide-20-corrected.webp",
    alt: "The corrected value with the exception answered"
  }
];

const TOOLS = [
  { tool: "get_customization", by: "Exposed by Customworks WebMCP on the product page", title: "The product states its own requirements", body: "The agent reads the fields the crewneck needs and their limits as a schema on the store's page and hands the payload to Tokuchu unchanged. Tokuchu holds no field list of its own for any product." },
  { tool: "set_gift_customization", by: "Exposed by Tokuchu WebMCP on the event page", title: "The RSVP list fills what it already holds", body: "Tokuchu maps each requirement to an RSVP answer or an event field or a question and asks attendees only for the rest. request_from_attendees and approve_specs run the collection and the approval from the same page." },
  { tool: "add_customized_to_cart", by: "Exposed by Customworks WebMCP on the product page", title: "One configured item per attendee reaches the cart", body: "The agent carries the manifest's cart_items to the store's page and the store fills its cart with one line per attendee and returns the Shopify checkout. Each call the store's page makes and each call Tokuchu's server makes record in the Agent trace drawer with the endpoint and the result." }
];

/** The chain the hero draws: what happens at each stage and which page exposes the capability. */
const CHAIN = [
  { stage: "Read", call: "get_customization", by: "Customworks WebMCP", what: "The store returns location and time and name under 20 and size" },
  { stage: "Collect", call: "request_from_attendees", by: "Tokuchu WebMCP", what: "Ask each attendee only for the values the RSVP list lacks" },
  { stage: "Order", call: "add_customized_to_cart", by: "Customworks WebMCP", what: "One configured item per attendee and the Shopify checkout" },
  { stage: "Fulfil", call: "get_fulfillment_manifest", by: "Tokuchu WebMCP", what: "The store reads the approved rows and posts exceptions through a signed link" }
];

/** The demo crewneck's contract as the store returns it and the source Tokuchu resolves for each field. */
const CONTRACT = [
  { field: "Location", rule: "required", source: "ask the attendee" },
  { field: "Time", rule: "required", source: "ask the attendee" },
  { field: "Printed name", rule: "required and under 20 characters", source: "already in the RSVP" },
  { field: "Size", rule: "required", source: "ask the attendee" }
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

/** The landing page: the two pages and their tools, the contract, the nine-step walkthrough with a capture per step, and how a judge runs it (PRD Sections 1, 3, and 12). */
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
              <li><a href="#parties">Who exposes what</a></li>
              <li><a href="#problem">The problem</a></li>
              <li><a href="#contract">The contract</a></li>
              <li><a href="#story">Walkthrough</a></li>
              <li><a href="#run">Run it</a></li>
              <li><a href="#why">Why WebMCP</a></li>
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
            <h1>Agents work directly off an RSVP list to tailor products to attendees.</h1>
            <p className="sub">One agent drives two pages through their WebMCP tools. It reads the product's requirements on the store's page and hands them to Tokuchu. Tokuchu asks each attendee only for the values the RSVP list lacks. The agent carries the approved items back to the store's cart.</p>
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
            <p className="contract-line">WebMCP is the contract on both pages. Customworks publishes the product's requirements and the cart action beside Shopify's commerce tools. Tokuchu publishes the RSVP records and the fulfilment manifest.</p>
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
              <span className="eyebrow">Who exposes what</span>
              <h2>Tokuchu publishes the RSVP records. Shopify publishes the commerce tools. Customworks publishes the product's rules. One agent calls all three.</h2>
            </div>
            <div className="parties" data-testid="parties">
              <div className="card">
                <span className="eyebrow">Tokuchu WebMCP</span>
                <h3>The records app on the organizer's side</h3>
                <p>Tokuchu holds the RSVP list. Its event page registers the records as tools so an agent can create the gift from the store's payload and request the missing values and approve at a revision. The invite page registers submit_rsvp for an attendee's agent. A signed link opens a store-facing page that registers the tools the grant allows.</p>
                <span className="shot"><img src="/media/tokuchu-attendees.webp" alt="Tokuchu's Attendees tab during the cart fill with the tour callout naming the calls" loading="lazy" /></span>
                <pre className="toolist" aria-label="Tokuchu's event page tools">{ORGANIZER_TOOLS.join("\n")}</pre>
                <pre className="toolist" aria-label="Tokuchu's invite page tool">submit_rsvp</pre>
                <pre className="toolist" aria-label="Tokuchu's store-facing page tools">{STORE_FACING_TOOLS.join("\n")}</pre>
              </div>
              <div className="card">
                <span className="eyebrow">Shopify WebMCP</span>
                <h3>Every store's commerce tools</h3>
                <p>Every Shopify storefront registers the same tools on its pages and answers the same calls at its UCP endpoint. The agent finds products and reads variants with them on the store's page. Tokuchu's own catalog search calls search_catalog at the Global Catalog and at each store's endpoint for an organizer who types a sentence.</p>
                <span className="shot"><img src="/media/shopify-search.webp" alt="The demo's search step calling search_catalog at Shopify's Global Catalog and at the store's endpoint" loading="lazy" /></span>
                <pre className="toolist" aria-label="Shopify's storefront WebMCP tools">{["search_catalog", "get_product", "show_variant", "browse_store", "get_cart", "update_cart", "cancel_cart", "proceed_to_checkout", "manage_orders", "search_shop_policies_and_faqs"].join("\n")}</pre>
              </div>
              <div className="card">
                <span className="eyebrow">Customworks WebMCP</span>
                <h3>The trial store built for this project</h3>
                <p>Customworks is a Shopify store set up for the 2026 WebMCP Challenge. Its theme registers two tools of its own beside Shopify's: one returns what a product needs to be made and one fills the cart with configured items. The agent calls both on the product page.</p>
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
                <strong>500 attendees × 3 fields = 1500 values</strong>
                <p>The same steps at the scale an event team works at.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="contract">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The merchant's contract</span>
              <h2>A personalized product can tell an agent how to order it.</h2>
              <p>The store publishes its required fields and their limits and its ordering operation as WebMCP tools. The agent reads the requirements on the store's page and hands them to Tokuchu through set_gift_customization. Tokuchu resolves each value against the RSVP record and asks attendees only for what is missing.</p>
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
              <h2>One event from the guest list to the store's fulfilment.</h2>
              <p>These captures come from the recorded demo and the two-sided acceptance run against the live store. The event is the 8th Annual Eastern Canada Astronomy Symposium in Toronto. Every attendee leaves with a crewneck showing a star map of the venue on the event date and printed with their name. Three attendees have replied.</p>
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
                        <p>Customworks is the trial Shopify store created for this project. Beside Shopify's own storefront tools it exposes two WebMCP functions on its product pages: one that returns the customization a product needs and its limits and one that fills the cart with configured lines. The next step reads the first of them.</p>
                        <p>The same path holds for other made-to-order products when the merchant exposes its required fields and its fulfilment action through WebMCP. The demo also orders the store's ceramic mug with a photo per attendee and a food item from another Shopify store through that store's UCP cart.</p>
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        <section id="run" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Run it</span>
              <h2>A browser agent or a terminal agent with a browser tool runs the whole order from the playbook.</h2>
              <p>With TOKUCHU_STATIC=1 the server opens no store page of its own. Every capability is a WebMCP tool on a page and the agent moves between Tokuchu's event page and the store's product page. The event page shows a handoff card per gift with the store URL and the product handle and the next tool on each side and carries the order of operations in an Agent notes block and a tokuchu-agent-task meta tag. The playbook holds the prompt and the steps and the error texts and npm run agent-playbook plays them with Playwright in place of a model.</p>
            </div>
            <pre className="toolist" aria-label="The commands that run the app for an agent" style={{ marginTop: 28 }}>{["TOKUCHU_STATIC=1 npm run dev -- -p 3114", "npm run agent-playbook", "npm run test:static"].join("\n")}</pre>
            <p className="whyfoot"><a href={PLAYBOOK_URL} target="_blank" rel="noreferrer" data-testid="playbook-link" style={{ textDecoration: "underline" }}>Read the agent playbook on GitHub</a></p>
          </div>
        </section>

        <section id="why">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Why WebMCP</span>
              <h2>Both pages publish their capabilities as tools with a name and a JSON Schema. The agent needs no integration for either.</h2>
              <p className="why-lead">The store states its required fields and validation rules and its ordering operation as tools on its product page. Tokuchu states its records and its fulfilment manifest as tools on its pages. An agent lists both with getTools and calls them with executeTool and works from the merchant's actual fulfilment rules and the organizer's actual RSVP list. Before WebMCP an app scraped the product page or built one integration per store.</p>
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
            <p className="whyfoot">The Agent trace drawer on every tab lists the WebMCP and UCP calls the server made and the calls a token holder made at the MCP endpoint with the side and the endpoint and the duration. Orders and fulfilment read back through Shopify's GraphQL Admin API. Payment happens at Shopify's checkout.</p>
          </div>
        </section>

        <section>
          <div className="wrap">
            <div className="cta-band">
              <h2>Turn the next guest list into a finished order.</h2>
              <p>Create an event and publish the invite. Read the store's requirements on its page and hand them to Tokuchu. Approve the records and fill the cart.</p>
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
            <a href="#run">Run it</a>
            <a href="#why">Why WebMCP</a>
          </div>
          <span><span lang="ja">特注</span> personalized orders for events</span>
        </div>
      </footer>
    </div>
  );
}
