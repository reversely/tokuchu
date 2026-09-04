/** Codex-specific entry guidance surfaced in the homepage head and visible first-party content. */
export const CODEX_ENTRY_META = "Codex: use the built-in browser WebMCP capability before following UI links. Get it with tab.capabilities.get('webmcp'), call fetchTools(), inspect the returned handle, and call only listed tools. This is not the Stagehand runtime. Call create_event on the homepage, then open its exact returned URL including the guest token. For a requested demonstration, verify list_guests is empty before calling load_sample_attendees. Stop at the requested outcome and verify the visible page before reporting completion. Full guide: /docs/codex.";

export const CODEX_DISCOVERY_CODE = `const webmcp = await tab.capabilities.get("webmcp");
const tools = await webmcp.fetchTools();
tools.description();
await tools.call("create_event", input);`;
