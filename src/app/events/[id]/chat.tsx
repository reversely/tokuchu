"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, ChatRole } from "../../../domain/types";
import { replyError } from "../../../lib/reply-error";
import { withDemoHeaders } from "../../../demo/token";

type ToolCall = { tool: string; label: string };
/** One NDJSON line of the chat stream: a tool start, an error, or the stored reply. */
type StreamLine = { kind: "tool"; tool: string; label: string } | { kind: "error"; error: string } | { kind: "done"; message: ChatMessage; tool_calls: ToolCall[] };

const WHO: Record<ChatRole, string> = { organizer: "You", assistant: "Assistant", system: "Tokuchu" };

/** A local id for the organizer's line before the server stores it. */
const pendingId = () => `pending-${Date.now()}`;

/**
 * The event's chat panel (#31): the thread from the snapshot, the box, and the running tool label
 * while a turn streams. The organizer's line and the reply show at once from the stream and drop
 * out of the local list as soon as the snapshot carries them. Below 900px the panel is a drawer
 * behind the Assistant button.
 */
export function Chat({ eventId, messages, onChanged }: { eventId: string; messages: ChatMessage[]; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<ToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const stored = new Set(messages.map((m) => m.id));
  const thread = [...messages, ...pending.filter((p) => !stored.has(p.id) && !messages.some((m) => m.role === p.role && m.text === p.text && m.at >= p.at))];

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, steps.length, busy]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    const line: ChatMessage = { id: pendingId(), event_id: eventId, role: "organizer", text: message, at: new Date().toISOString(), tool_calls: [], schedule_id: null };
    setPending((prev) => [...prev, line]);
    setText("");
    setBusy("Sending the message");
    setSteps([]);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/chat?stream=1`, withDemoHeaders({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }));
      if (!res.ok) throw new Error(await replyError(res));
      if (!res.body) throw new Error("The run returned nothing");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const parsed = JSON.parse(raw) as StreamLine;
          if (parsed.kind === "tool") {
            setBusy(parsed.label);
            setSteps((prev) => [...prev, { tool: parsed.tool, label: parsed.label }]);
          } else if (parsed.kind === "error") throw new Error(parsed.error);
          else {
            setPending((prev) => [...prev, parsed.message]);
            onChanged();
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setSteps([]);
    }
  }

  return (
    <>
      <aside className={`chat${open ? " open" : ""}`} aria-label="Event assistant" data-testid="chat-panel">
        <div className="chat-head">
          <h2>Assistant</h2>
          <button type="button" className="btn ghost small chat-close" onClick={() => setOpen(false)} data-testid="chat-close">Close</button>
        </div>
        <div className="chat-thread" ref={threadRef} data-testid="chat-thread">
          {thread.length === 0 && !busy && <p className="hint chat-empty">Ask about the guests or the gifts or say what to change</p>}
          {thread.map((m) => (
            <div className={`chat-msg ${m.role}`} key={m.id} data-testid="chat-message" data-role={m.role}>
              <span className="who">{WHO[m.role]}</span>
              <p>{m.text}</p>
              {m.tool_calls.length > 0 && (
                <ul className="chat-tools" aria-label="Tools the assistant used">
                  {m.tool_calls.map((c, i) => (
                    <li key={`${c.tool}-${i}`}><code>{c.tool}</code> {c.label}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {busy && (
            <div className="chat-msg assistant chat-running" data-testid="chat-busy">
              <span className="who">Assistant</span>
              <ul className="chat-tools">
                {steps.map((s, i) => (
                  <li key={`${s.tool}-${i}`} className={i === steps.length - 1 ? "now" : ""}><code>{s.tool}</code> {s.label}</li>
                ))}
                {steps.length === 0 && <li className="now">{busy}</li>}
              </ul>
            </div>
          )}
          {error && <p className="error" role="alert" data-testid="chat-error">{error}</p>}
        </div>
        <form className="chat-box" onSubmit={send}>
          <input aria-label="Message the assistant" placeholder="Ask or say what to change" value={text} onChange={(e) => setText(e.target.value)} data-testid="chat-input" />
          <button type="submit" className="btn primary small" disabled={!!busy || !text.trim()} data-testid="chat-send">Send</button>
        </form>
      </aside>
      {!open && (
        <button type="button" className="btn primary chat-toggle" onClick={() => setOpen(true)} data-testid="chat-toggle">Assistant</button>
      )}
    </>
  );
}
