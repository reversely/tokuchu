import type { ReactNode } from "react";

export const metadata = {
  title: "Architecture · Tokuchu",
  description: "How managed mode and agent mode coordinate Tokuchu and Customworks through server tools and WebMCP."
};

function Node({ label, title, children, active = false }: { label: string; title: string; children: ReactNode; active?: boolean }) {
  return <div className={`arch-node${active ? " active" : ""}`}><span>{label}</span><strong>{title}</strong><p>{children}</p></div>;
}

const LAYERS = [
  { label: "1 · Intent", title: "Goal + prompts", detail: "The requested procurement outcome and operating constraints." },
  { label: "2 · Reasoning", title: "Browser agent", detail: "Selects the next action from live schemas, state, and results." },
  { label: "3 · Browser", title: "WebMCP discovery", detail: "Discovers tools on each page through document.modelContext." },
  { label: "4 · Capabilities", title: "Page tools", detail: "The business tools published by Tokuchu and Customworks." }
];

const STAGES = [
  {
    eyebrow: "Stage 1 · State the intent",
    heading: "The organizer describes outcomes, not browser mechanics.",
    body: "The initial prompts establish the event, the purchasing goal, and the completion criteria. They drive the browser agent; the organizer does not name individual tools.",
    prompts: [
      ["Prompt 1 · Create the event", "Create an event in Tokuchu for the Eastern Canada Astronomy Symposium on March 15, 2027, at the Ontario Science Centre."],
      ["Prompt 2 · Look for items", "Find two suitable custom products: one mug with our logo, and one sweatshirt with a customizable celestial map. Then, help me get the information I need from participants to get these items."],
      ["Prompt 3 · Prepare the carts", "Add every complete and accepted attendee's customized products to the shopping carts; ping incomplete attendees; tell me who was included, who is pending, and the total quote."]
    ]
  },
  {
    eyebrow: "Stage 2 · Decide what happens next",
    heading: "The agent turns each outcome into state-aware decisions.",
    body: "The browser agent reads the prompts, the current conversation, and prior tool results. It decides whether to create the event, inspect another tab, compare product requirements, request missing attendee values, or prepare a cart. It does not assume a fixed call sequence: readiness and returned schemas determine the next move."
  },
  {
    eyebrow: "Stage 3 · Operate the browser",
    heading: "The browser discovers available tools on each page.",
    body: "ChatGPT's browser, or the local Stagehand runner, opens Tokuchu and Customworks. The browser discovers the WebMCP registrations available on each page through document.modelContext. It carries out the tool call chosen by the agent and returns the result. The browser does not define the procurement logic."
  },
  {
    eyebrow: "Stage 4 · Execute domain capabilities",
    heading: "The websites perform the actual event and commerce work.",
    body: "Tokuchu's page tools create the event, reconcile attendee state, request missing answers, approve a revision, and expose the fulfillment manifest. Customworks' page tools describe customization, accept configured cart lines, and report order status. Their structured results return to the agent to inform its next decision."
  }
];

export default function ArchitecturePage() {
  return (
    <main className="docs-page">
      <nav className="docs-nav"><a className="brand" href="/">Tokuchu<span>.</span></a><a href="/">Back to overview</a></nav>
      <header className="docs-hero"><span className="eyebrow">Architecture</span><h1>One record model, three ways to interact.</h1><p>Tokuchu owns attendance and procurement records. Customworks owns products and commerce. ChatGPT&apos;s browser agent coordinates between them through WebMCP tools. The interface walkthrough and the local Stagehand runner are additional methods.</p></header>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Runtime configurations</span><h2>The store boundary has one owner at a time.</h2><p>Both configurations use the same Tokuchu records and validation. They differ only in who discovers products and calls the store.</p></div>
        <div className="runtime-configs">
          <article>
            <span className="eyebrow">Default</span><h3>Managed mode</h3><p>The organizer uses the Tokuchu dashboard. The optional OpenAI assistant calls safe server functions. Tokuchu searches Shopify through UCP and opens merchant pages for WebMCP customization and cart tools.</p>
            <img className="runtime-diagram" src="/media/managed-mode-architecture.svg" alt="Managed mode architecture with the organizer UI and OpenAI assistant connected to the Tokuchu server which calls Shopify UCP and merchant WebMCP tools" />
          </article>
          <article>
            <span className="eyebrow">TOKUCHU_STATIC=1</span><h3>Agent mode</h3><p>A browser agent operates the Tokuchu and store tabs. ChatGPT&apos;s browser discovers and calls WebMCP tools directly; the local Stagehand runner does the same through Playwright. Tokuchu acts as the live record database. It makes no outbound store calls.</p>
            <img className="runtime-diagram" src="/media/agent-mode-architecture.svg" alt="Agent mode architecture with a browser agent between the Tokuchu records tab and Shopify store tab using WebMCP" />
          </article>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Browser-agent lifecycle</span><h2>The same chain, seen at four moments.</h2><p>Each view highlights the layer responsible for that moment. Stagehand is properly visible as the browser layer, while the user&apos;s intent and the websites&apos; domain tools remain the beginning and end of the process.</p></div>
        <div className="architecture-stages">
          {STAGES.map((stage, activeIndex) => <article className="architecture-stage" key={stage.eyebrow}>
            <div className="arch-flow" role="img" aria-label={`${stage.eyebrow}. ${LAYERS[activeIndex].title} is highlighted in the four-layer browser-agent flow.`}>
              {LAYERS.map((layer, index) => <div className="arch-flow-part" key={layer.title}><Node label={layer.label} title={layer.title} active={index === activeIndex}>{layer.detail}</Node>{index < LAYERS.length - 1 && <i aria-hidden="true">→</i>}</div>)}
            </div>
            <div className="stage-situation"><span className="eyebrow">{stage.eyebrow}</span><h3>{stage.heading}</h3><p>{stage.body}</p>
              {stage.prompts && <div className="prompt-stack">{stage.prompts.map(([label, prompt]) => <blockquote key={label}><strong>{label}</strong><p>{prompt}</p></blockquote>)}</div>}
            </div>
          </article>)}
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Run agent mode</span><h2>Start the records app before launching the agent.</h2><p>The agent-mode runbook covers prerequisites, launch commands, the expected cross-site sequence, verification, and common failures.</p></div>
        <p><a href="https://github.com/reversely/tokuchu/blob/main/docs/agent-mode.md">Open the agent-mode runbook →</a></p>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Two tabs, separate ownership</span><h2>The business state stays with the website that owns it.</h2></div>
        <div className="tab-architecture">
          <article><img src="/media/tokuchu-banner.webp" alt="Tokuchu banner" /><h3>Tokuchu: RSVP Application with Attendee States</h3><p>Attendance, recipient fields, requests, readiness, approvals, revisions, scoped grants, and fulfillment manifests.</p><div className="mini-tools"><code>get_requirements</code><code>get_fulfillment_manifest</code><code>approve_specs</code><code>post_update</code></div></article>
          <div className="tab-bridge"><span>Browser agent via WebMCP</span><b>← <code>get_customization</code></b><b><code>add_customized_to_cart</code> →</b><b>← <code>get_order_updates</code></b></div>
          <article><img src="/media/customworks-banner.webp" alt="Customworks banner" /><h3>Customworks: Shopify Store with WebMCP-enabled Customization</h3><p>Products, variants, customization constraints, configured cart lines, checkout, and order status.</p><div className="mini-tools"><code>get_customization</code><code>add_customized_to_cart</code><code>get_order_updates</code></div></article>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Local Stagehand runner</span><h2>Five generic controls expose every discovered business tool.</h2><p>The local Stagehand runner gives the model five stable browser controls and lets the websites describe their current capabilities. ChatGPT&apos;s browser discovers and calls WebMCP tools natively; these controls are specific to the Stagehand implementation.</p></div>
        <div className="control-cards">
          <article><code>open_page</code><p>Opens a URL in the shared browser context and assigns the page a tab ID.</p></article>
          <article><code>list_webmcp_tools</code><p>Calls <code>Page.tools()</code> and returns names, descriptions, input schemas, and frame IDs.</p></article>
          <article><code>call_webmcp_tool</code><p>Resolves a page tool, invokes structured input, waits, and normalizes content and errors.</p></article>
          <article><code>switch_tab</code><p>Moves the active Stagehand page between Tokuchu state and the storefront.</p></article>
          <article><code>record_checkout</code><p>Records the captured checkout through Tokuchu without exposing the raw URL to the model.</p></article>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Runtime boundaries</span><h2>Agent mode is explicit and auditable.</h2></div>
        <div className="boundary-grid">
          <article><h3>Agent mode</h3><p>With <code>TOKUCHU_STATIC=1</code>, Tokuchu omits server-side store operations. Stagehand becomes the explicit bridge, and the model discovers and selects calls dynamically.</p></article>
          <article><h3>Managed mode</h3><p>Tokuchu performs storefront WebMCP calls behind the organizer interface. The procurement lifecycle is the same; only the boundary-crossing actor changes.</p></article>
          <article><h3>Traceability</h3><p>The runtime records model decisions, browser controls, WebMCP results, and the final outcome in <code>tests/videos/agent-run-*.json</code>.</p></article>
          <article><h3>Deterministic fallback</h3><p><code>npm run agent-playbook</code> uses Playwright and the WebMCP polyfill in a fixed order. It tests the same handoffs without model-driven decisions.</p></article>
        </div>
      </section>
    </main>
  );
}
