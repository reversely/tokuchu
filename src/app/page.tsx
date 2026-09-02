import { library } from "../domain/store";
import { currentCaller } from "../server/ownership";
import { listOwnedEvents } from "../server/persistence";
import { DraftPage } from "./draft-page";
import { MyEvents } from "./my-events";
import { SessionPill } from "./session-pill";

/** The organizer's events above the draft: one page for the event's details, the questions guests answer, and the settings (PRD Section 5). */
export default async function Page() {
  const caller = await currentCaller();
  const events = caller ? <MyEvents events={await listOwnedEvents(caller.id)} /> : null;
  return <DraftPage library={library()} account={<SessionPill />} events={events} />;
}
