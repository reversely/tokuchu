"use client";
import { useEffect, useState } from "react";

/** The story in the order it is told; each beat types out on its own before the next one. */
export const INTRO_BEATS = [
  "Meet Jack. He organizes the 8th Annual Eastern Canada Astronomy Symposium and he is expecting 500 participants from around the world this year.",
  "Keeping track of every participant's needs and preferences is hard. Linking those preferences to the personalized merchandise attendees expect is harder.",
  "Tokuchu can help. Using WebMCP across Shopify's catalog of stores it finds a full suite of personalized merchandise and fills every unit in from one source of truth: Tokuchu's RSVP list."
];

/** One word every WORD_MS: a paragraph settles in a few seconds instead of ticking in letter by letter. */
const WORD_MS = 110;
const BEAT_PAUSE_MS = 2200;

type Props = { autoplay: boolean; onDone: () => void };

/** The opening screen of the tour: the portrait and the story, each paragraph settling in a word at a time. */
export function Intro({ autoplay, onDone }: Props) {
  const [beat, setBeat] = useState(0);
  const [shown, setShown] = useState(0);
  const [reduced, setReduced] = useState(false);
  const text = INTRO_BEATS[beat];
  const words = text.split(" ");
  const typed = shown >= words.length;
  const last = beat === INTRO_BEATS.length - 1;

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) {
      setShown(words.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => setShown((n) => (n >= words.length ? n : n + 1)), WORD_MS);
    return () => clearInterval(timer);
  }, [beat, words.length, reduced]);

  useEffect(() => {
    if (!autoplay || !typed) return;
    const timer = setTimeout(() => (last ? onDone() : setBeat((b) => b + 1)), BEAT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [autoplay, typed, last, onDone]);

  const next = () => (typed ? (last ? onDone() : setBeat((b) => b + 1)) : setShown(words.length));

  return (
    <div className="intro" data-testid="intro" data-beat={beat} role="dialog" aria-label="The story behind this walkthrough">
      <img className="intro-art" src="/media/jack.webp" alt="Jack at a telescope under a crescent moon" />
      <div className="intro-copy">
        <span className="intro-count">{beat + 1} of {INTRO_BEATS.length}</span>
        <p className="intro-text" data-testid="intro-text" aria-live="polite">
          {words.map((w, i) => <span key={i} className={`intro-word${i < shown ? " on" : ""}`}>{w} </span>)}
        </p>
        <div className="intro-actions">
          <button type="button" className="btn primary" onClick={next} data-testid="intro-next">{typed ? (last ? "Start the walkthrough" : "Next") : "Show the rest"}</button>
          <button type="button" className="btn ghost" onClick={onDone} data-testid="intro-skip">Skip the story</button>
        </div>
      </div>
    </div>
  );
}
