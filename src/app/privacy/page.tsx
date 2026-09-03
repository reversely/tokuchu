export const metadata = { title: "Privacy · Tokuchu", description: "Tokuchu privacy and data-handling notice." };

export default function PrivacyPage() {
  return <main className="docs-page legal-page">
    <nav className="docs-nav"><a className="brand" href="/">Tokuchu<span>.</span></a><a href="/">Back to overview</a></nav>
    <header className="docs-hero"><span className="eyebrow">Privacy notice</span><h1>Data is shared according to the job each participant needs to do.</h1><p>Last updated September 3, 2026. This notice describes the Tokuchu demonstration application and its browser-agent workflows.</p></header>
    <section className="legal-copy">
      <h2>Information Tokuchu handles</h2><p>Tokuchu may hold organizer account details, event information, attendee names and RSVP states, answers requested for a selected product, procurement approvals and revisions, vendor updates, and checkout or order references. Organizers decide which attendee fields to collect. Attendees submit their own responses through an invite link.</p>
      <h2>How information is used</h2><p>The application uses this information to manage attendance, reconcile product requirements, request missing values, validate recipient readiness, prepare a fulfillment manifest, support organizer approval, and coordinate fulfillment updates or corrections.</p>
      <h2>Vendor access</h2><p>A vendor does not receive the full RSVP record. Tokuchu can issue a signed, scoped grant for one procurement. That view exposes only the attributes and operations allowed by the grant, may expire, and can be revoked. A vendor may post structured production updates or request clarification from an affected attendee.</p>
      <h2>Browser agents and external services</h2><p>In agent handoff mode, Stagehand operates a browser containing Tokuchu and Customworks tabs. An OpenAI Agents SDK model may receive tool descriptions, structured tool inputs, results, and the operating context needed to choose the next action. Product, cart, checkout, and order operations are processed by Shopify or the relevant storefront. Authentication email may be delivered through the configured email provider. Those services process information under their own terms.</p>
      <h2>Logs and demonstration data</h2><p>The browser-agent runner writes local transcripts containing model decisions, tool calls, results, and final outcomes for debugging and evaluation. Operators should review transcripts before sharing them and avoid using sensitive real-world data in a demonstration environment. Seeded demo attendees are fictional test data.</p>
      <h2>Retention and control</h2><p>Retention depends on how the operator deploys Tokuchu and configures its database and logs. Organizers can control collected event fields and vendor grants. Repository operators are responsible for access control, deletion procedures, credentials, and applicable privacy obligations in their deployment.</p>
      <h2>Questions</h2><p>For this open-source demonstration, use the project repository&apos;s issue tracker to ask about data handling. A production operator should replace this section with its own privacy contact and jurisdiction-specific disclosures.</p>
    </section>
  </main>;
}
