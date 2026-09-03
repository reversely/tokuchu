/**
 * The seeded demo event as data: the astronomy symposium the recorded walkthrough runs, the three
 * gifts the tour chooses, the store two of them come from, and the three attendees the tour loads
 * through the RSVP API in place of email replies. `/demo` creates the event; the tour (#20) reads the
 * rest.
 */

/** The body `POST /api/events` accepts, as `EventBody` in src/server/api.ts parses it. */
export const DEMO_EVENT = {
  title: "8th Annual Eastern Canada Astronomy Symposium",
  host: "Eastern Canada Astronomy Society",
  starts_at: "2027-03-15T19:00:00Z",
  venue: { name: "Metro Toronto Convention Centre", line1: "255 Front St W", city: "Toronto", region: "ON", postal_code: "M5V 2W6", country: "CA" },
  cost_per_person_cents: 25000,
  rsvp_deadline: "2027-01-03",
  description: "Every attendee leaves with a crewneck showing a star map of the venue on the event date and printed with their name, a mug printed with a photo of their own, and a box of treats.",
  delivery: { destination: "venue", address: null, needed_by: "2027-03-08" }
};

/** The demo store built for this project, whose crewneck and mug the tour picks, and the sentence the tour searches with. */
export const DEMO_STORE = {
  shop_domain: "springbuilt.myshopify.com",
  shop_name: "Customworks",
  search: "personalized star map crewnecks with each attendee's name"
};

/** The three gifts the tour chooses, keyed as the steps name them. */
export type DemoGiftKey = "crewneck" | "mug" | "food";

/**
 * How the tour tells the three gifts apart on the event: the two from the demo store by a word in
 * the product title, and the food and beverage item as the one from any other store. The food card
 * in src/agent/cards.json runs its searches in Shopify's food and beverage category.
 */
export const DEMO_GIFTS: Record<DemoGiftKey, { label: string; shop_domain: string | null; title: RegExp | null; card: string | null }> = {
  crewneck: { label: "the crewneck", shop_domain: DEMO_STORE.shop_domain, title: /crewneck/i, card: null },
  mug: { label: "the mug", shop_domain: DEMO_STORE.shop_domain, title: /mug/i, card: null },
  food: { label: "the food and beverage gift", shop_domain: null, title: null, card: "food_drink" }
};

/** The order the tour picks the gifts in and approves them in. */
export const DEMO_GIFT_ORDER: DemoGiftKey[] = ["crewneck", "mug", "food"];

/**
 * The replies the tour loads: the name on the shirt, the size choice, the star map's place and
 * time, and the photo the mug carries. Each photo is an image on the store's own CDN, so the store's
 * cart tool accepts the address and the page shows the picture. The third attendee's place is the
 * bare "Cambridge", which the store's agent sends back as a question (#53).
 */
export const DEMO_ATTENDEES = [
  { display_name: "Avery Chen", size: "M", location: "Toronto", time: "21:00", photo: "https://cdn.shopify.com/s/files/1/0832/1322/2137/files/1f55e5cb-9041-4c81-ac8b-c3ff16fed99c.jpg" },
  { display_name: "Blake Rivera", size: "L", location: "Vancouver", time: "22:30", photo: "https://cdn.shopify.com/s/files/1/0832/1322/2137/files/98b0ef2e-030f-4228-820a-813972a3c509.png" },
  { display_name: "Carmen Diaz", size: "XL", location: "Cambridge", time: "20:15", photo: "https://cdn.shopify.com/s/files/1/0832/1322/2137/files/4c45e795-0cf3-42c0-907b-af95e7f94dcc.png" }
];

/**
 * The store's exception and its correction (#53): the attendee whose star map location the store's
 * agent questions, the value given, the store's message, and the value the attendee saves through
 * the reply link.
 */
export const DEMO_CORRECTION = { attendee: "Carmen Diaz", requirement: "star_map_location", given: "Cambridge", message: "Which Cambridge is the star map for", corrected: "Cambridge, Massachusetts, USA" };
