import type { OwnedEvent } from "../server/persistence";

const STATUS_LABEL: Record<OwnedEvent["status"], string> = { draft: "Draft", published: "Published" };

/** The signed-in organizer's events with a link into each and one to the draft below. */
export function MyEvents({ events }: { events: OwnedEvent[] }) {
  return (
    <section className="block" aria-labelledby="my-events" data-testid="my-events">
      <div className="labelrow">
        <h2 id="my-events">Your events</h2>
        <a className="btn ghost small" href="#new-event" data-testid="new-event-link">Create a new event</a>
      </div>
      {events.length === 0 ? (
        <p className="lead" data-testid="my-events-empty">No events yet</p>
      ) : (
        <ul className="list">
          {events.map((event) => (
            <li className="row" key={event.id} data-testid="my-event">
              <a href={`/events/${event.id}`}>{event.title}</a>
              <span className="type">{STATUS_LABEL[event.status]}</span>
              <span className="type">{event.invite_code ? `/i/${event.invite_code}` : ""}</span>
              <span className="type">{new Date(event.updated_at).toLocaleDateString("en-CA")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
