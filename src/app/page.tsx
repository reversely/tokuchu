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
      "On the Guest Experience tab the organizer types one sentence about the item. The search calls search_catalog at Shopify's Global Catalog and at the store's own endpoint and ranks what comes back.",
      "The organizer picks the Customworks star map crewneck from the ranked results."
    ],
    window: "Tokuchu Guest Experience",
    media: "/media/step2-search-pick.gif",
    alt: "The search ranking the store's crewneck and the organizer picking it"
  },
  {
    title: "The store returns its requirements and the app compares them with the RSVP.",
    body: [
      "Confirming the pick calls the store's get_customization tool on its product page. The tool answers with the fields the crewneck needs and their limits: a star map location and a time and a printed name under 20 characters.",
      "The app compares each field with what the RSVP already holds. The printed name comes from the RSVP. The location and the time and the size become questions for each attendee."
    ],
    window: "Tokuchu Attendees",
    media: "/media/step3-requirements.gif",
    alt: "The requirements the store returned with the source of each value"
  },
  {
    title: "Request the values and watch the records fill.",
    body: [
      "One click sends each attendee an email with a link to a form holding only the fields the crewneck needs. Each reply fills a row in the records grid with one column per field. The app follows up with whoever has not answered.",
      "The replies in this recording load through the RSVP API in place of email replies."
    ],
    window: "Tokuchu Attendees",
    media: "/media/step4-request-records.gif",
    alt: "The request going out and the responses filling the records grid"
  },
  {
    title: "Approve and open the checkout.",
    body: [
      "When every row is complete the organizer approves. The app calls the store's add_customized_to_cart tool once with one item per attendee.",
      "The tool returns a checkout link and the organizer opens it to a cart with one line per attendee and the values on every line."
    ],
    window: "Customworks checkout",
    media: "/media/step5-approve-checkout.gif",
    alt: "The approval filling the store's cart and the checkout showing one line per attendee"
  }
];

const TOOLS = [
  { tool: "search_catalog", title: "Find the product", body: "The search calls Shopify's catalog tools at the Global Catalog and at each store's endpoint and ranks the results for the organizer's sentence." },
  { tool: "get_customization", title: "Read the requirements", body: "The store's own tool returns the fields the product needs and their limits. A field the RSVP does not hold becomes a question for each attendee." },
  { tool: "add_customized_to_cart", title: "Write the order", body: "The store's second tool adds one configured line per attendee to the cart and returns the checkout link the organizer opens." }
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
              <li><a href="#problem">The problem</a></li>
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
            <h1 className="sr-only">Turn an RSVP list into one personalized order per attendee.</h1>
            <p className="sub">Tokuchu reads a product's requirements from a WebMCP store and asks each attendee only for the values that product needs. The finished cart returns to the organizer with one line per attendee.</p>
            <div className="cta">
              <a className="btn primary big" href={start} data-testid="start-hero">Create an event</a>
              <a className="btn ghost big" href="/demo" data-testid="demo">Try the demo</a>
            </div>
            <p className="note"><b>Works with</b> Shopify stores over WebMCP and the GraphQL Admin API.</p>
          </div>
        </section>

        <section id="problem" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The problem</span>
              <h2>Personalizing an event means collecting one answer per attendee per field.</h2>
              <p>An organizer orders a conference tote printed with each attendee's name or a crewneck showing a star map of the venue on the event date. Choosing the item takes one decision. Collecting what the store needs to make one unit per person takes a question to every attendee.</p>
              <p>The organizer asks each attendee for a size and a spelling and keeps the answers in a spreadsheet. The organizer then chases the attendees who have not replied and re-types each row into the store's checkout. A wrong name or size on a unit costs a reprint and a late delivery.</p>
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
                <div className="story-step" key={step.media} data-testid="walkthrough-step">
                  <div className="copy">
                    <div className="stepno">{i + 1}</div>
                    <h3>{step.title}</h3>
                    {step.body.map((line) => <p key={line}>{line}</p>)}
                  </div>
                  <Window title={step.window}>
                    <img src={step.media} alt={step.alt} loading="lazy" />
                  </Window>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="usecase" data-testid="usecase">
          <div className="wrap usecase">
            <img className="banner" src="/media/customworks-banner.webp" alt="Customworks. Make it your own. A Shopify storefront for the 2026 WebMCP Challenge" loading="lazy" />
            <div className="usecase-copy">
              <span className="eyebrow">One use case</span>
              <h2>A store that publishes what its products need.</h2>
              <p>Customworks is the demo storefront built for this project. Beside Shopify's own storefront tools it exposes a callable WebMCP tool that returns the customization a product needs and its limits. Tokuchu reads that tool on the pick and fills the store's cart through its second tool.</p>
              <p>The same contract fits any store whose products are made to order. Event merchandise is one case. Team kits and named gifts and engraved awards follow the same path once the store publishes the tool.</p>
            </div>
          </div>
        </section>

        <section id="why" className="tint">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Why WebMCP</span>
              <h2>The store hands the agent its own requirements.</h2>
              <p className="why-lead">Before WebMCP an app read a store's personalization options by scraping its product page or by building one integration per store. WebMCP lets a store publish its search and its product options and its cart as tools with a name and a JSON Schema. Tokuchu calls those tools. Any WebMCP-enabled Shopify store answers the search. Personalization needs the store to publish the two merchant tools.</p>
            </div>
            <div className="why" data-testid="tools">
              {TOOLS.map((card) => (
                <div className="card" key={card.tool}>
                  <span className="tag">{card.tool}</span>
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
