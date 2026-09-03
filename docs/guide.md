# Using Tokuchu

This guide walks an organizer through Tokuchu from sign-in to a filled store cart, and names the WebMCP tool each screen calls. WebMCP is the browser standard that lets a page register tools an agent can call through `document.modelContext`. Tokuchu sits between two sets of those tools: the storefront's and its own.

| Who exposes it | Tool | What Tokuchu does with it |
|---|---|---|
| Shopify, on every storefront and at the Global Catalog endpoint | `search_catalog`, `get_product`, `get_cart`, `update_cart` and the rest of the catalog and cart set | Finds products across stores and reads their variants and delivery terms |
| Customworks, the demo store built for this project, on its product pages | `get_customization` | Reads the fields a personalized product needs and the limits on each |
| Customworks, on its product pages | `add_customized_to_cart` | Adds one configured unit per attendee to the store's cart and returns the checkout link |
| Tokuchu, on the organizer's event page | `list_guests`, `list_missing`, `get_requirements`, `request_from_attendees`, `follow_up`, `approve` and eleven more | Lets an agent read the RSVP list and run the same steps this guide clicks through |
| Tokuchu, on the attendee's invite page | `submit_rsvp` | Lets an attendee's agent reply and answer the product's questions |

The screens below come from `scripts/capture-guide.mjs`, which drives a local server through the whole flow against the live demo store.

## 1. Sign in

Open the site and choose Sign in. Enter your email address and send the link. A first sign-in creates your account; there is no password. The link opens the page you came from, or your events list.

![The sign-in page](media/guide/01-sign-in.png)

Two other ways in:

- **Try the demo** runs the whole flow as a guest on a seeded event, with a guided tour and no account. The guest's event is kept when the guest creates an account from the band.
- **A denied address** lands on the not-found page with a link to the demo. The deployment can restrict sign-in to a list of organizer addresses; when it does, an address outside the list is denied.

An attendee never signs in. Their invite link opens without a session.

## 2. Your events

Your events lists the events your account owns and nothing else; each account sees only its own. Create a new event opens the form.

![The events list](media/guide/02-your-events.png)

## 3. Create the event

The form holds the details attendees see, the venue the gifts are delivered to, and the date they are needed by. The venue address matters twice: the invite shows it, and every catalog search checks that a product ships to it in time.

![The new event form](media/guide/03-new-event.png)

- **Title, date, host, description** appear on the invite.
- **Venue** is the delivery address. The fields accept the browser's address autofill.
- **Spots and RSVP deadline** feed the counts on the overview.
- **Notes on the invite** are short lines under the details, such as the dress code or where to park. Type one and press Enter; click a note to remove it.
- **Needed by** is the date the gifts must arrive. A search excludes any product whose delivery window ends after it.

Publish creates the invite link.

## 4. The overview

The event page has three tabs. Overview shows the counts, the invite link, the guest list, the follow-ups the replies still need, and the gifts chosen so far.

![The overview after publishing](media/guide/04-overview.png)

- **Copy invite link** copies the link every attendee replies through.
- **Guests** takes one name per line, or `Name <email>`, or a bare email. A listed guest who replies updates their own row instead of adding one.
- **Agent tools ready** in the band means the page has registered Tokuchu's organizer tools over WebMCP. An agent in the browser can call them; the Attendees tab lists them.
- **Gifts** links to Guest Experience while none is chosen.

## 5. What an attendee sees

The invite link opens the event with a reply form. The attendee gives a name, an email address, and a reply, then answers whatever questions the organizer has asked so far. The email is required for anyone going or maybe going, because a later request for a missing detail is sent there.

![The invite as an attendee sees it](media/guide/05-invite.png)

The same form registers as the WebMCP tool `submit_rsvp` on this page. Its input schema lists one property per question with the store's limits, so an attendee's browser agent can answer without touching the form. The link keeps the reply: opening it again shows the saved answers and lets the attendee change them or cancel.

## 6. Search the catalog over WebMCP

Guest Experience starts with a search. Pick a card or describe the item in a sentence.

The search calls `search_catalog` on Shopify's Global Catalog endpoint and on the demo store's own endpoint, with the venue's address as the shipping context. The funnel under the heading shows each call: the query, how many products it returned of how many the catalog holds, and the price ceiling it searched under. Distinct products are merged across the calls, and the best candidates get a delivery check against the venue and the needed-by date.

![The search funnel](media/guide/06-search-funnel.png)

The results are ranked real products from real stores. Each card names the store and, when the delivery check passed, the date the product arrives by.

![The ranked results](media/guide/07-search-results.png)

## 7. Pick a product and read its customization

Click a result. The next step chooses who receives it, by default everyone going.

![Choosing the recipients](media/guide/08-recipients.png)

The step after maps a choice question to the product's variants and sets a default for anyone who has not answered, a rule for a missing required answer, and what happens to a unit whose attendee cancels after checkout.

![The variants step](media/guide/09-variants.png)

Add this gift is where the store's own WebMCP tool comes in. For the demo store, Tokuchu opens the product page on the server and calls `get_customization`. The store answers with the fields the product needs, each with its kind and limits, and with the variants it sells. Those land on the gift. Tokuchu holds no field list of its own for any product; the store's answer is the only source.

![The gift with the store's fields and variants](media/guide/10-gift-with-customization.png)

For a product from any other store the catalog's variants stand in, and there is no customization step.

## 8. Request the missing details from attendees

The Attendees tab compares the store's fields with what the RSVP list already holds. A field that matches an existing answer, such as the printed name, is resolved from the list. The rest are shown as questions to ask.

![The fields the product needs](media/guide/11-requested-fields.png)

Request from attendees turns each open field into a question with the store's limit or choices, and emails every going attendee who lacks an answer a link to their own reply form. The band's tool list names this step `request_from_attendees`, and an agent can run it the same way.

![The request sent](media/guide/12-request-sent.png)

Send follow-up emails everyone whose request still has an unanswered question. An attendee with no email address is listed as such; they add one by opening their reply link again.

## 9. The records grid and the routing

Each reply fills a row: one column per requirement, with the attendee's answer or a marker for what is still missing. An answer changed after approval is marked so you can re-approve.

![The records grid](media/guide/13-records-grid.png)

Under the grid, How this reaches the store lists every WebMCP hop for this gift: the store, its endpoint, the Shopify page tools on its pages, the store's `get_customization` and `add_customized_to_cart`, and Tokuchu's own `request_from_attendees`.

![The WebMCP routing to the store](media/guide/14-webmcp-routing.png)

## 10. Approve and fill the cart

Approve and fill the cart records the approval and starts the cart job. Tokuchu opens the store's product page on the server and calls `add_customized_to_cart` once, with one item per attendee: the variant their size resolved to and their values for every field. The store adds the lines to a cart and returns its checkout link, which appears under the approval.

![The approval and the cart link](media/guide/15-approved-cart-link.png)

A row that is not ready is listed under the button with the reason. When attendees have not confirmed their specifications yet, a Send email reminders button is beside the message; when a field was never requested, the request button is.

## 11. Review the cart at the store

The link opens the store's cart in any browser, with a personalized line per attendee. Checkout happens at the store, with the store's own payment.

![The store's cart with one line per attendee](media/guide/16-store-cart.png)

## When something looks wrong

- **A search shows 0 of 0 in the catalog.** The catalog answered with nothing for that query and ceiling. Try a broader sentence.
- **The server answered without a reply, or the connection dropped.** The instance was restarting, which happens on every deploy. Wait a minute and press the button again. A gift may have saved before the reply was lost; the list refreshes to show it.
- **No email address** beside a request means the attendee replied without one. Their reply link lets them add it; the next follow-up then reaches them.
- **Agent tools unavailable in this browser** means the browser has no WebMCP support and the page did not load the polyfill. The buttons still work; only the agent path is off. Adding `?webmcp=polyfill` to the event URL loads the polyfill.
