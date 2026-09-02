import { library } from "../domain/store";
import { DraftPage } from "./draft-page";
import { SessionPill } from "./session-pill";

/** The draft: one page for the event's details, the questions guests answer, and the settings (PRD Section 5). */
export default function Page() {
  return <DraftPage library={library()} account={<SessionPill />} />;
}
