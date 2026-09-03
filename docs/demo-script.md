# Demo script

The demo narration written by the project's author, kept verbatim. The homepage (`src/app/page.tsx`) follows its order beat by beat.

Six years ago, I cofounded a cafe where much of our revenue has come from bulk orders for events. Event organizers often request customizations, from dietary restrictions to names printed on party favours.

But the specifications for these customizations can be difficult to collect. Organizers may not yet know exactly who is attending, what each guest needs, or which details a vendor requires, which creates a lot of manual back and forth.

Agents can help coordinate this information if there is an intermediate source of truth that can both consume requirements from e-commerce sites and expose the resulting fulfillment data back to other agents through WebMCP.

To explore this, I created a pair of websites: an RSVP application called Tokuchu, and a Shopify store called Customworks. Both expose custom WebMCP functions, allowing agents on either side of a purchase to work against the same evolving order state.

Tokuchu helps event organizers collect RSVP information and use that attendee data when making purchasing decisions. It can call WebMCP tools exposed by storefronts, reconcile their customization requirements against information it already has, request anything that is still missing, and expose a scoped fulfillment view back to an authorized vendor.

Customworks sells dropshipped, customized merchandise. Its WebMCP tools describe what information each product needs for personalization and can return updates about the resulting order.

Let's say Kevin is hosting an astronomy conference and wants to send participants customized celestial shirts.

He uses Shopify's Global Catalog to find a suitable product and arrives at Customworks. The celestial shirt exposes a custom WebMCP function called get_customization, which tells the agent that each shirt requires a printed name, a shirt size, and a location for the star map.

Tokuchu's agent compares those requirements against Kevin's RSVP data.

It already has each attendee's preferred name, so that requirement can be mapped directly. If shirt size has already been collected, Tokuchu can reuse that as well. But it does not have a star-map location, so Tokuchu creates that as a new required attendee field and requests the missing information from the relevant participants.

Once those responses come back, Tokuchu validates the data and assembles a fulfillment manifest containing only the information required for this procurement.

Kevin can review and approve that exact revision of the order.

Customworks can then be given scoped access to the procurement. Its own agent can call Tokuchu's WebMCP tools to retrieve the approved fulfillment manifest without gaining access to unrelated RSVP information.

If something changes, that shared state can change with it. For example, if a vendor determines that an attendee's star-map location is too ambiguous, its agent can submit a structured request for clarification. Tokuchu records the exception, routes it back to the attendee, and exposes the corrected value in the next revision.

Once the fulfillment data is complete, Kevin's agent can use Shopify's native WebMCP tools to place the configured items into the cart and continue through checkout.

Throughout the demo, Tokuchu is both consuming WebMCP from storefronts and exposing WebMCP back to other authorized agents.

The result is a shared source of truth for customized procurement: vendor requirements can be reconciled against information the organizer already has, missing data can be collected only when necessary, and each party's agent can access the specific information it needs to move the order forward.
