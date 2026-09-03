import type { ReactNode } from "react";

export const metadata = {
  title: "Architecture · Tokuchu",
  description: "How Stagehand browser agents coordinate Tokuchu and Customworks through native WebMCP tools."
};

function Node({ label, title, children, accent = false }: { label: string; title: string; children: ReactNode; accent?: boolean }) {
  return <div className={`arch-node${accent ? " accent" : ""}`}><span>{label}</span><strong>{title}</strong><p>{children}</p></div>;
}

export default function ArchitecturePage() {
  return (
    <main className="docs-page">
      <nav className="docs-nav"><a className="brand" href="/">Tokuchu<span>.</span></a><a href="/">Back to overview</a></nav>
      <header className="docs-hero"><span className="eyebrow">Architecture</span><h1>Stagehand connects the agent to two live WebMCP surfaces.</h1><p>Tokuchu remains the source of truth for attendance and procurement. Customworks remains the source of truth for products, carts, and orders. The browser agent coordinates them without collapsing those responsibilities.</p></header>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Browser-agent runtime</span><h2>Goal → reasoning → browser → page capabilities</h2></div>
        <div className="arch-flow" role="img" aria-label="A goal and playbook pass to the OpenAI Agents SDK, which controls Stagehand, which discovers WebMCP tools registered by Tokuchu and Customworks.">
          <Node label="1 · Intent" title="Goal + playbook">Defines the desired procurement outcome and safety constraints.</Node><i aria-hidden="true">→</i>
          <Node label="2 · Reasoning" title="OpenAI Agents SDK">Chooses the next page and capability from schemas and prior results.</Node><i aria-hidden="true">→</i>
          <Node label="3 · Browser" title="Stagehand" accent>Wraps one Chrome context, keeps both tabs available, and exposes <code>Page.tools()</code>.</Node><i aria-hidden="true">→</i>
          <Node label="4 · Capabilities" title="Native WebMCP">Returns tools registered on each page&apos;s <code>document.modelContext</code>.</Node>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Two tabs, separate ownership</span><h2>The business state stays with the website that owns it.</h2></div>
        <div className="tab-architecture">
          <article><img src="/media/tokuchu-banner.webp" alt="Tokuchu banner" /><h3>Tokuchu: RSVP Application with Attendee States</h3><p>Attendance, recipient fields, requests, readiness, approvals, revisions, scoped grants, and fulfillment manifests.</p><div className="mini-tools"><code>get_requirements</code><code>get_fulfillment_manifest</code><code>approve_specs</code><code>post_update</code></div></article>
          <div className="tab-bridge"><span>Stagehand browser context</span><b>← <code>get_customization</code></b><b><code>add_customized_to_cart</code> →</b><b>← <code>get_order_updates</code></b></div>
          <article><img src="/media/customworks-banner.webp" alt="Customworks banner" /><h3>Customworks: Shopify Store with WebMCP-enabled Customization</h3><p>Products, variants, customization constraints, configured cart lines, checkout, and order status.</p><div className="mini-tools"><code>get_customization</code><code>add_customized_to_cart</code><code>get_order_updates</code></div></article>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Agent adapter</span><h2>Five generic controls expose every discovered business tool.</h2><p>The runtime does not wrap every Tokuchu or Customworks operation as a permanent model tool. Instead, it gives the model five stable browser controls and lets the websites describe their current capabilities.</p></div>
        <div className="control-cards">
          <article><code>open_page</code><p>Opens a URL in the shared browser context and assigns the page a tab ID.</p></article>
          <article><code>list_webmcp_tools</code><p>Calls <code>Page.tools()</code> and returns names, descriptions, input schemas, and frame IDs.</p></article>
          <article><code>call_webmcp_tool</code><p>Resolves a page tool, invokes structured input, waits, and normalizes content and errors.</p></article>
          <article><code>switch_tab</code><p>Moves the active Stagehand page between Tokuchu state and the storefront.</p></article>
          <article><code>record_checkout</code><p>Records the captured checkout through Tokuchu without exposing the raw URL to the model.</p></article>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-heading"><span className="eyebrow">Runtime boundaries</span><h2>Agent handoff is explicit and auditable.</h2></div>
        <div className="boundary-grid">
          <article><h3>Agent handoff mode</h3><p>With <code>TOKUCHU_STATIC=1</code>, Tokuchu omits server-side store operations. Stagehand becomes the explicit bridge, and the model discovers and selects calls dynamically.</p></article>
          <article><h3>Managed mode</h3><p>Tokuchu performs storefront WebMCP calls behind the organizer interface. The procurement lifecycle is the same; only the boundary-crossing actor changes.</p></article>
          <article><h3>Traceability</h3><p>The runtime records model decisions, browser controls, WebMCP results, and the final outcome in <code>tests/videos/agent-run-*.json</code>.</p></article>
          <article><h3>Deterministic fallback</h3><p><code>npm run agent-playbook</code> uses Playwright and the WebMCP polyfill in a fixed order. It tests the same handoffs without model-driven decisions.</p></article>
        </div>
      </section>
    </main>
  );
}
