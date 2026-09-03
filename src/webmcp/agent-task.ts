/**
 * The task text an agent reads on each page in static mode (#56): what the page is for and the
 * order of the tool calls. The page renders it as a visible Agent notes block and as the
 * `tokuchu-agent-task` meta tag, so an agent that reads the DOM and one that reads the head both
 * find it. docs/agent-playbook.md spells the same order out for a person.
 */
export type AgentPage = "landing" | "event" | "invite" | "store";
export type AgentTask = { summary: string; steps: string[] };

export const AGENT_TASK_META = "tokuchu-agent-task";

const EVENT: AgentTask = {
  summary: "Tokuchu runs as a records app for a browser agent. Every capability is a WebMCP tool on this page and the store's product page carries the rest.",
  steps: [
    "If the event has no guests and the run is a demonstration call load_sample_attendees; its reply carries each attendee's offline details for later answers.",
    "List the tools with document.modelContext.getTools() and read the guests with list_guests.",
    "Open the store's product page and call get_customization with the product id.",
    "Call set_gift_plan without a gift_id to create the gift from the product.",
    "Call set_gift_customization with the payload get_customization returned.",
    "Read get_requirements and map what an existing answer fills with set_personalization_mapping.",
    "Call request_from_attendees and ask only what list_missing names.",
    "Read get_fulfillment_manifest until every attendee reads ready and then call approve_specs.",
    "Take cart_items from get_fulfillment_manifest to the store's page and call add_customized_to_cart with an idempotency_key.",
    "Record the checkout_url with post_update."
  ]
};

const INVITE: AgentTask = {
  summary: "This invite registers submit_rsvp with one property per question and the store's limits on each.",
  steps: [
    "List the tools with document.modelContext.getTools() and read the schema of submit_rsvp.",
    "Call submit_rsvp with display_name and status and email and every required answer.",
    "The reply returns a guest_id; call again with it to change an answer.",
    "An error names the question and its limit; correct that value and call again."
  ]
};

const STORE: AgentTask = {
  summary: "This page opens one procurement for the store under a signed grant and registers the grant's tools.",
  steps: [
    "Read get_procurement and then get_fulfillment_manifest at the approved revision.",
    "Post accepted or production_started or fulfilled through post_procurement_update.",
    "Post needs_information or invalid_value or option_unavailable with attendee_ref and requirement_id when a value cannot be used.",
    "Read get_changes after the revision you last saw and call acknowledge_changes with the current one."
  ]
};

const LANDING: AgentTask = {
  summary: "Tokuchu's landing page registers the tools that start an event: create_event and add_guests. The event page the reply names carries the rest.",
  steps: [
    "List the tools with document.modelContext.getTools().",
    "Call create_event with the title and the start and the venue and the guest list; keep the event_id and open the url it returns.",
    "Call add_guests with the event_id to add more guests later; a name already on the list is skipped.",
    "On the event page list the tools again and continue with list_guests."
  ]
};

const TASKS: Record<AgentPage, AgentTask> = { landing: LANDING, event: EVENT, invite: INVITE, store: STORE };

export function agentTask(page: AgentPage): AgentTask {
  return TASKS[page];
}

/** The meta tag's content: the summary and the numbered steps on one line. */
export function agentTaskText(page: AgentPage): string {
  const task = agentTask(page);
  return [task.summary, ...task.steps.map((step, i) => `${i + 1}. ${step}`)].join(" ");
}
