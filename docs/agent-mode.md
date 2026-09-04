# Run Tokuchu in agent mode

Agent mode makes a browser agent the explicit bridge between Tokuchu and a WebMCP-enabled store. Tokuchu remains the live database and validation layer. It does not search Shopify, open merchant pages, or run a cart-fill job.

![Agent mode architecture](../public/media/agent-mode-architecture.svg)

## Prerequisites

- Node dependencies installed with `npm run setup`.
- `OPENAI_API_KEY` present in `.env` or the shell.
- Chrome 149 or later.
- Network access to the demo Shopify store.
- The store page must register its tools on `document.modelContext`.

## 1. Start Tokuchu in agent mode

Run the records application on its dedicated port:

```sh
TOKUCHU_STATIC=1 npm run dev -- -p 3114
```

Confirm that `http://localhost:3114` opens. The flag disables only Tokuchu's outbound store automation. The UI, API, persistence, validation, and page tools remain active.

## 2. Launch the browser agent

In another terminal:

```sh
npm run agent-run -- \
  "Use the WebMCP tools exposed by Tokuchu and the store. Add the personalized crewneck for every attendee marked going. Include every ready attendee. Leave incomplete attendees pending. Record the checkout in Tokuchu. Stop before payment. Report who was added and who still needs information."
```

The default run creates a demo event and starts on its event page. To start from the landing page and let the agent create the event:

```sh
AGENT_START=landing npm run agent-run -- \
  "Create the event and add the supplied guests. Stop after reporting the event URL and the number of guests added."
```

Use one outcome per run. This gives the agent a clear stopping point and avoids silently progressing from event creation into procurement.

## 3. What the runtime gives the model

The model receives five generic controls:

| Control | Purpose |
| --- | --- |
| `open_page` | Open a URL in the shared browser context |
| `list_webmcp_tools` | Read the names, descriptions, schemas, and frame IDs registered by a page |
| `call_webmcp_tool` | Invoke one discovered tool with structured arguments |
| `switch_tab` | Bring a Tokuchu or store page to the front |
| `record_checkout` | Record the captured checkout URL without exposing its token to the model |

The runtime does not give the model a hard-coded list of Tokuchu or store operations. The page is the capability boundary. The agent must list the current tools before its first call on a page and after navigation when the surface may have changed.

## 4. Expected cross-site flow

1. Tokuchu: discover tools and call `list_guests`.
2. Store: discover tools and call `get_customization`.
3. Tokuchu: call `set_gift_plan` and `set_gift_customization`.
4. Tokuchu: call `get_requirements` and request only missing values.
5. Tokuchu: read `get_fulfillment_manifest` and approve the current revision.
6. Store: send the manifest's `cart_items` to `add_customized_to_cart`.
7. Tokuchu: call `record_checkout` so the gift stores the checkout reference.

IDs, field keys, variants, mappings, and cart items must come from earlier tool results. The agent should never invent them.

## 5. Verify the run

The terminal prints every generic browser call and its result. A successful procurement run should show:

- WebMCP tools listed on both tabs.
- A customization contract returned by the store.
- A gift and mappings stored in Tokuchu.
- A fulfilment manifest with ready or incomplete rows.
- An approval at the current revision.
- Ready rows accepted by the store cart.
- A checkout reference recorded on the Tokuchu gift.

The full transcript is written to `tests/videos/agent-run-<timestamp>.json`. It contains the demo event session token. Remove query parameters containing `?t=` before sharing it.

## Deterministic fallback

To verify the same WebMCP handoffs without a model:

```sh
npm run agent-playbook
```

This uses Playwright and the WebMCP polyfill with a fixed sequence. It is useful for separating page-tool or store failures from model-planning failures.

## Common failures

| Symptom | Check |
| --- | --- |
| No server at the configured base URL | Start Tokuchu with `TOKUCHU_STATIC=1` on port 3114 or set `AGENT_BASE` |
| The server is not in agent mode | Restart it with `TOKUCHU_STATIC=1` |
| A page registers no tools | Confirm Chrome support and that the page loaded its WebMCP registration code |
| The tool name is ambiguous | Pass the `frame_id` returned by `list_webmcp_tools` |
| A record or variant is missing | Reuse the exact identifier from the earlier tool result |
| Approval is stale | Read the manifest again and approve its current revision |
| Cart input is rejected | Correct the named field in Tokuchu and regenerate `cart_items` |

The stable operating policy used by the model lives in [agent-runtime.md](agent-runtime.md). The exhaustive tool sequence and error catalog live in [agent-playbook.md](agent-playbook.md).
