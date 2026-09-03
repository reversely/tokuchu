export const metadata = { title: "Terms · Tokuchu", description: "Terms for the Tokuchu demonstration application." };

export default function TermsPage() {
  return <main className="docs-page legal-page">
    <nav className="docs-nav"><a className="brand" href="/">Tokuchu<span>.</span></a><a href="/">Back to overview</a></nav>
    <header className="docs-hero"><span className="eyebrow">Terms</span><h1>Terms for the Tokuchu demonstration.</h1><p>Last updated September 3, 2026.</p></header>
    <section className="legal-copy">
      <h2>Demonstration software</h2><p>Tokuchu is an experimental application illustrating RSVP-driven customized procurement and WebMCP browser-agent coordination. It is provided for evaluation and demonstration, not as a promise of production availability or fitness for a particular purchase.</p>
      <h2>Your responsibilities</h2><p>Use information you are authorized to provide, obtain any required attendee consent, review customization and fulfillment data before approval, protect invite and vendor-grant links, and verify storefront pricing, delivery, checkout, and order details before committing to a transaction.</p>
      <h2>Agents and automated actions</h2><p>Browser agents can discover and invoke tools exposed by Tokuchu and external storefronts. Their output may be incomplete or incorrect. You remain responsible for reviewing approvals, configured items, checkout details, vendor messages, and any external transaction.</p>
      <h2>Third-party services</h2><p>Shopify storefronts, payment providers, email delivery, model providers, and other integrated services are independent services governed by their own terms. Tokuchu does not control their availability, products, pricing, fulfillment, or policies.</p>
      <h2>No warranty</h2><p>The demonstration is provided as-is and without warranties to the extent permitted by law. A production operator should replace these terms with provisions appropriate to its service, users, and jurisdiction.</p>
    </section>
  </main>;
}
