/**
 * The demo organizer's event as data: the astronomy symposium the recorded walkthrough runs, the
 * crewneck store the tour searches, and the three attendees the tour loads through the RSVP API in
 * place of email replies. `/demo` creates the event; the tour (#20) reads the rest.
 */

/** The body `POST /api/events` accepts, as `EventBody` in src/server/api.ts parses it. */
export const DEMO_EVENT = {
  title: "8th Annual Eastern Canada Astronomy Symposium",
  host: "Eastern Canada Astronomy Society",
  starts_at: "2027-03-15T19:00:00Z",
  venue: { name: "Metro Toronto Convention Centre", line1: "255 Front St W", city: "Toronto", region: "ON", postal_code: "M5V 2W6", country: "CA" },
  cost_per_person_cents: 25000,
  rsvp_deadline: "2027-01-03",
  description: "Every attendee leaves with a crewneck showing a star map of the venue on the event date and printed with their name.",
  delivery: { destination: "venue", address: null, needed_by: "2027-03-08" }
};

/** The demo store built for this project, whose crewneck the tour picks, and the sentence the tour searches with. */
export const DEMO_STORE = {
  shop_domain: "springbuilt.myshopify.com",
  shop_name: "Customworks",
  search: "personalized star map crewnecks with each attendee's name"
};

/** The replies the tour loads: the name on the shirt, the size choice, and the star map's place and time. */
export const DEMO_ATTENDEES = [
  { display_name: "Avery Chen", size: "M", location: "Toronto", time: "21:00" },
  { display_name: "Blake Rivera", size: "L", location: "Vancouver", time: "22:30" },
  { display_name: "Carmen Diaz", size: "XL", location: "Montreal", time: "20:15" }
];
