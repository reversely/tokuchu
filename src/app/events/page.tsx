import { listOwnedEvents } from "../../server/persistence";
import { MyEvents } from "../my-events";
import { accountOrSignIn } from "../organizer-gate";
import { SessionPill } from "../session-pill";

/** The signed-in organizer's events with a link into each and one to a new draft. */
export default async function Page() {
  const caller = await accountOrSignIn("/events");
  return (
    <>
      <header className="band">
        <a className="brand" href="/">Tokuchu</a>
        <div className="right">
          <a className="btn primary" href="/events/new" data-testid="new-event-link">Create a new event</a>
          <SessionPill />
        </div>
      </header>
      <main className="sheet">
        <div className="wrap solo">
          <MyEvents events={await listOwnedEvents(caller.id)} />
        </div>
      </main>
    </>
  );
}
