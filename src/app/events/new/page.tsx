import { library } from "../../../domain/store";
import { DraftPage } from "../../draft-page";
import { accountOrSignIn } from "../../organizer-gate";
import { SessionPill } from "../../session-pill";

/** The draft for a new event (PRD Section 5): its details, the questions guests answer, and the settings. */
export default async function Page() {
  await accountOrSignIn("/events/new");
  return <DraftPage library={library()} account={<SessionPill />} />;
}
