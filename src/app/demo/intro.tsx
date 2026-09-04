"use client";

export const INTRO_BEATS = [
  "Meet Kevin. Kevin organizes the 8th Annual Eastern Canada Astronomy Symposium and expects 500 participants from around the world this year.",
  "Keeping track of every participant's needs and preferences is hard. Linking those preferences to the personalized merchandise attendees expect is harder.",
  "Tokuchu can help. It finds personalized merchandise through Shopify's catalog and then works each store's own WebMCP tools to fill every unit in from one source of truth: Tokuchu's RSVP list."
];

type Props = { autoplay: boolean; onDone: () => void };

export function Intro({ onDone }: Props) {
  return (
    <div className="intro" data-testid="intro" role="dialog" aria-label="The story behind this walkthrough">
      <img className="intro-art" src="/media/jack.webp" alt="Kevin at a telescope under a crescent moon" />
      <div className="intro-copy">
        {INTRO_BEATS.map((text, i) => (
          <p key={i} className="intro-block" data-testid={i === 0 ? "intro-text" : undefined}>{text}</p>
        ))}
        <div className="intro-actions">
          <button type="button" className="btn primary" onClick={onDone} data-testid="intro-next">Start the walkthrough</button>
        </div>
      </div>
    </div>
  );
}
