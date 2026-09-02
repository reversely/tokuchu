/**
 * The tour's steps as data, in the order tests/flow-demo.spec.ts runs them. The tour reads a step's
 * tab and target to place the callout, its narration to tell the organizer's situation, its action
 * name to drive the page's own controls, and its `done` predicate to skip a step the event already
 * shows finished.
 */
import { DEMO_STORE } from "./seed";

export type TourTab = "overview" | "experience" | "attendees";
export type TourAction = "search" | "pick" | "request" | "answer" | "approve" | "cart";

/** A `data-testid` on the page; `shop` narrows a result card to the one from that store. */
export type TourTarget = { testId: string; shop?: string };

/** What the tour reads from the dashboard's snapshot to decide which steps the event already shows finished. */
export type TourState = {
  guests: { status: string }[];
  requests: { complete: boolean }[];
  gifts: { locked_at: string | null; checkout_url?: string | null }[];
};

export type TourStep = {
  id: string;
  tab: TourTab;
  target: TourTarget;
  title: string;
  narration: string;
  action?: TourAction;
  done?: (state: TourState) => boolean;
};

const hasGift = (s: TourState) => s.gifts.length > 0;
const hasRequests = (s: TourState) => s.requests.length > 0;
const hasAnswers = (s: TourState) => s.guests.filter((g) => g.status === "going").length >= 3 && hasRequests(s) && s.requests.every((r) => r.complete);
const isApproved = (s: TourState) => Boolean(s.gifts[0]?.locked_at);
const hasCheckout = (s: TourState) => Boolean(s.gifts[0]?.checkout_url);

export const STEPS: TourStep[] = [
  {
    id: "published",
    tab: "overview",
    target: { testId: "invite-link" },
    title: "The event is published",
    narration: "I run the Eastern Canada Astronomy Symposium every year and order one crewneck per attendee. The event is published, and attendees reply through this invite link."
  },
  {
    id: "search",
    tab: "experience",
    target: { testId: "sentence" },
    title: "Describe the item",
    narration: "I need one crewneck per attendee with a star map of the venue and each person's name on it. I describe it in a sentence and the app searches Shopify stores over WebMCP.",
    action: "search",
    done: hasGift
  },
  {
    id: "pick",
    tab: "experience",
    target: { testId: "result", shop: DEMO_STORE.shop_domain },
    title: "Pick the store's crewneck",
    narration: "The results come from Shopify's catalog and from each store's own endpoint. I pick the crewneck from the store that prints star maps and confirm the recipients, and the app asks that store for its customization fields through get_customization.",
    action: "pick",
    done: hasGift
  },
  {
    id: "requirements",
    tab: "attendees",
    target: { testId: "requested-info" },
    title: "The store's requirements",
    narration: "The store answered with the fields this crewneck needs, and the app shows each one with where its value comes from. The name comes from the RSVP. The size and the star map details have to come from each attendee."
  },
  {
    id: "request",
    tab: "attendees",
    target: { testId: "request-fields" },
    title: "Request the missing values",
    narration: "I ask for the missing values. Each attendee gets an email with a link to a form that carries the store's limits and choices.",
    action: "request",
    done: hasRequests
  },
  {
    id: "answers",
    tab: "attendees",
    target: { testId: "attendees" },
    title: "Attendees answer",
    narration: "Replies arrive as attendees fill in the form. In this demo the three replies load through the same RSVP API, and each one fills a row in the records grid.",
    action: "answer",
    done: hasAnswers
  },
  {
    id: "approve",
    tab: "attendees",
    target: { testId: "approve-send" },
    title: "Approve",
    narration: "Every row is complete, so I approve. Approval locks the answers, and the app calls the store's add_customized_to_cart with one item per attendee.",
    action: "approve",
    done: isApproved
  },
  {
    id: "cart",
    tab: "attendees",
    target: { testId: "approve-block" },
    title: "The cart fills at the store",
    narration: "The app opens the store's page and adds the items to its cart. When the store answers, the checkout link appears here.",
    action: "cart",
    done: hasCheckout
  },
  {
    id: "checkout",
    tab: "attendees",
    target: { testId: "review-cart" },
    title: "Open the checkout",
    narration: "The cart is at the store with one line per attendee. I open the checkout and pay. I typed nothing into the store by hand."
  }
];

/**
 * The step a returning visitor resumes at: the first step whose work the event does not show
 * finished, backed up to the informational step that introduces it.
 */
export function startIndex(state: TourState, steps: TourStep[] = STEPS): number {
  const firstOpen = steps.findIndex((s) => s.done && !s.done(state));
  let index = firstOpen === -1 ? steps.length - 1 : firstOpen;
  while (index > 0 && !steps[index - 1].done) index -= 1;
  return index;
}
