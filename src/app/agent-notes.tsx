import { agentTask, type AgentPage } from "../webmcp/agent-task";

/** The visible Agent notes block (#56): the page's task and the order of the tool calls, for an agent that reads the DOM. */
export function AgentNotes({ page }: { page: AgentPage }) {
  const task = agentTask(page);
  return (
    <section className="block" aria-labelledby="agent-notes" data-testid="agent-notes" data-page={page}>
      <div className="labelrow"><h2 id="agent-notes">Agent notes</h2><span className="eyebrow">WebMCP</span></div>
      <p className="lead" style={{ marginBottom: 12 }}>{task.summary}</p>
      <ol className="agent-steps">
        {task.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </section>
  );
}
