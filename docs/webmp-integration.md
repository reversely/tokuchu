# Task: Add Agentic Customily Personalization to Tokuchu

Extend the existing Tokuchu RSVP application so an organizer can describe a curated merchandise experience in natural language, have an OpenAI agent select an appropriate product and map RSVP data into its personalization inputs, then create a token-scoped handoff that can configure each attendee’s item through Customily.

Use the current repository as the source of truth:

* Tokuchu overview: https://github.com/reversely/webmcp/blob/main/README.md
* Tokuchu tools: https://github.com/reversely/webmcp/blob/main/src/webmcp/tools.ts
* Domain types: https://github.com/reversely/webmcp/blob/main/src/domain/types.ts
* Gift planning: https://github.com/reversely/webmcp/blob/main/src/domain/gifts.ts
* Shopify cart: https://github.com/reversely/webmcp/blob/main/src/agent/cart.ts
* Personalized Printshop adapter: https://github.com/reversely/webmcp/blob/main/src/agent/printshop.ts
* Personalized Printshop cart: https://github.com/reversely/webmcp/blob/main/src/agent/printshop-cart.ts
* Existing scripted vendor client: https://github.com/reversely/webmcp/blob/main/scripts/vendor-agent.mts
* Existing OpenAI Agents SDK implementation: https://github.com/reversely/webmcp/blob/main/3droom-concept/src/agent/planning-agent.ts
* Customily test product: https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt

Read these files before making architectural changes. Reuse existing domain operations, gift state, token permissions, manifests, approval stages, delivery fields and Shopify integration.

## Product outcome

An organizer can enter a request such as:

> Create personalized sweatshirts for everyone attending. Use the event location and date for the star map, put each guest’s preferred name underneath, and ship everything to the event.

Tokuchu should then:

1. Send this request to a real OpenAI agent.
2. Retrieve the event and RSVP context through controlled tools.
3. Search the existing WebMCP/UCP product catalogs.
4. Select an eligible product.
5. Retrieve that product’s personalization schema.
6. map event and RSVP fields to the product inputs.
7. Produce a per-attendee personalization manifest.
8. Present the proposed product and mappings for organizer approval.
9. Issue a restricted vendor token.
10. Configure one Customily item per attendee.
11. Add each configured item through Customily’s own cart flow.
12. Preserve Tokuchu’s existing approval, change-feed and event-address delivery workflow.

## Current repository baseline

Tokuchu already implements:

* Guest, party and event records.
* Attribute definitions and typed RSVP answers.
* Organizer WebMCP tools.
* Token-restricted vendor MCP access.
* Shopify UCP catalog search and ranking.
* Product and variant selection.
* Gift plans, rules, overrides, fallbacks and cutoffs.
* One manifest row per guest.
* Cart creation, synchronization, approval and checkout preparation.
* Event-address delivery.
* Vendor updates and change feeds.
* A Printshop integration with one personalized unit per recipient.

Build on these components.

The existing `scripts/vendor-agent.mts` is a scripted MCP client. Add a real model-backed curation agent by following the Agents SDK pattern in `3droom-concept`.

## Required architecture

### 1. CurationAgent

Add:

```text
src/agent/curation-agent.ts
```

Use the same OpenAI Agents SDK and tracing pattern as `3droom-concept/src/agent/planning-agent.ts`.

The agent should receive an organizer instruction and access narrowly scoped tool wrappers for:

* Event summary.
* Available RSVP definitions.
* Missing RSVP values.
* Existing gift search.
* Candidate personalization schemas.
* Gift-plan selection.
* Personalization mapping.
* Manifest validation.
* Vendor handoff preparation.

The agent should call existing domain functions directly through tool wrappers. Keep catalog search, delivery validation, variant resolution and manifest construction deterministic.

The model is responsible for:

* Interpreting the organizer’s intent.
* Selecting relevant RSVP and event fields.
* Comparing eligible products.
* Proposing a product.
* Constructing explicit personalization mappings.
* Explaining missing values or ambiguities.
* Asking for organizer input when a required field lacks a valid source.

The model must use retrieved product and field identifiers. Store mappings as structured data.

### 2. Agent API and UI

Add a server endpoint using the project’s existing API conventions. It should accept:

```ts
{
  event_id: string;
  message: string;
}
```

Return enough structured information for the UI to display:

```ts
{
  response: string;
  proposal?: {
    gift_id: string;
    product: Candidate;
    personalization_mapping: PersonalizationMapping[];
    manifest_summary: {
      ready: number;
      incomplete: number;
      excluded: number;
    };
    issues: PersonalizationIssue[];
  };
  tool_calls: AgentToolCallSummary[];
  trace_id?: string;
}
```

Add a curation input to the existing organizer experience. The organizer must be able to:

* Enter a natural-language request.
* See that a model request is running.
* See the proposed product.
* Review mapping rows.
* See attendee coverage and missing values.
* Approve or revise the proposal.
* Continue into the existing vendor-handoff flow.

Expose tool activity as concise UI states such as “Reading RSVP fields,” “Searching products,” and “Validating 18 attendee configurations.”

### 3. Personalization types

Extend the existing personalization field model.

```ts
type PersonalizationKind =
  | "text"
  | "date"
  | "location"
  | "star_map"
  | "image"
  | "vector"
  | "qr_code"
  | "spotify"
  | "color"
  | "word_list";
```

Each product field should support:

```ts
type PersonalizationField = {
  key: string;
  label: string;
  kind: PersonalizationKind;
  required: boolean;
  max_length?: number;
  allowed_values?: string[];
  value_type?: string;
};
```

Add mappings to the existing gift batch:

```ts
type PersonalizationMapping = {
  vendor_field_key: string;

  source:
    | {
        type: "definition";
        definition_id: string;
        subject_scope: "guest" | "party" | "event";
      }
    | {
        type: "event";
        key: "title" | "starts_at" | "venue";
      }
    | {
        type: "literal";
        value: unknown;
      };

  transform?:
    | "uppercase"
    | "lowercase"
    | "date_only"
    | "location_query";
};
```

Preserve the mappings in the existing `Batch` or gift-plan representation. Follow the repository’s current persistence conventions.

### 4. Mapping mutation

Add one organizer-only Tokuchu tool:

```text
set_personalization_mapping
```

Input:

```ts
{
  gift_id: string;
  mappings: PersonalizationMapping[];
}
```

Validation must confirm:

* The gift exists.
* Every vendor field exists in the selected product schema.
* Required vendor fields have mappings.
* RSVP definition IDs exist.
* Source scopes match their definitions.
* Source and target types are compatible.
* Restricted definitions remain protected by token visibility.
* Supported transforms match the source value type.

Use normal WebMCP registration and HTTP/MCP routes so the operation works through both access paths.

### 5. Personalized manifest

Extend the existing manifest rather than creating a second manifest system.

Each personalized row should contain:

```ts
type PersonalizedManifestRow = ManifestRow & {
  personalization: Record<
    string,
    {
      value: unknown;
      source: PersonalizationMapping["source"];
    }
  >;

  personalization_status: "ready" | "incomplete" | "invalid";
  personalization_issues: PersonalizationIssue[];
};
```

A missing required value should generate a structured issue:

```ts
type PersonalizationIssue = {
  guest_id?: string;
  vendor_field_key: string;
  code:
    | "missing_source"
    | "missing_value"
    | "invalid_type"
    | "too_long"
    | "unsupported_value";
  message: string;
};
```

Extend `get_manifest` to return these fields when the selected product supports personalization.

Preserve the current manifest response for ordinary products.

### 6. Per-recipient cart behavior

Keep the existing aggregated `quantities()` and Shopify cart behavior for ordinary products.

For personalized products, create one unit per guest:

```ts
type PersonalizedUnit = {
  recipient_ref: string;
  product_id: string;
  variant_id: string;
  values: Record<string, unknown>;
};
```

Use `printshop-cart.ts` as the behavioral reference.

Three guests using the same sweatshirt size must produce three separately configured units rather than one line with quantity three.

### 7. Customily WebMCP adapter

Create a version-controlled storefront adapter, for example:

```text
integrations/customily/webmcp-customily.js
```

Provide installation instructions for adding it to the Shopify theme containing the Customily product.

Expose generic tools through `document.modelContext`:

#### `get_personalization_schema`

Returns the available Customily fields for the current product.

#### `configure_personalized_unit`

Input:

```ts
{
  recipient_ref: string;
  variant_id: string;
  values: Record<string, unknown>;
}
```

This tool must:

* Select the requested Shopify variant.
* Populate Customily controls.
* Trigger the input, change and blur events required by Customily.
* Wait for Customily to update its preview.
* Validate all required inputs.
* Return a structured configuration result.

#### `get_personalization_preview`

Return:

```ts
{
  recipient_ref: string;
  ready: boolean;
  preview_url?: string;
  preview_id?: string;
  errors: Array<{
    field_key?: string;
    message: string;
  }>;
}
```

#### `add_personalized_unit_to_cart`

Invoke Customily’s own Add to Cart behavior after successful configuration.

Return a cart-line or configuration identifier that can be associated with the Tokuchu guest reference.

Use semantic field configuration for the MVP product instead of scattering CSS selectors throughout the tools. For example:

```ts
const productAdapters = {
  "<shopify-product-id>": {
    fields: {
      star_map_location: { /* Customily control adapter */ },
      star_map_date: { /* Customily control adapter */ },
      caption: { /* Customily control adapter */ }
    }
  }
};
```

Inspect the live product page to identify its actual controls and required Customily events.

### 8. Vendor execution

Extend or add a vendor execution script that:

1. Connects to Tokuchu’s tokenized MCP endpoint.
2. Calls `get_manifest`.
3. Processes only rows with `personalization_status: "ready"`.
4. Opens the Customily-enabled Shopify product.
5. Discovers its WebMCP tools.
6. Calls `get_personalization_schema`.
7. Configures one unit per guest.
8. Retrieves or verifies the preview.
9. Adds the unit through Customily.
10. Posts success or failure through Tokuchu’s existing `post_update`.
11. Retains the Tokuchu `guest_id` as the recipient reference.

Use Playwright for the clickable demonstration and browser lifecycle. Invoke the page’s registered WebMCP tools as the interaction contract. Keep direct DOM interaction inside the storefront WebMCP adapter.

### 9. Initial Customily experiments

Implement these incrementally:

#### Experiment 1: Per-guest lettering

Map a guest RSVP field such as `preferred_name` to one Customily text field.

Success means three guests create three cart lines with three different names.

#### Experiment 2: Event-level star map

Map:

* Event venue to location.
* Event start date to date.

Success means every unit receives the same event-specific star map values.

#### Experiment 3: Mixed personalization

Map:

* Event venue to star-map location.
* Event start date to star-map date.
* Guest preferred name to caption.
* Guest apparel size to Shopify variant.

This is the primary MVP demonstration.

Treat QR codes, uploaded images, vectors and Spotify inputs as follow-up schema types after the three experiments above pass.

## Approval and spending behavior

Use Tokuchu’s existing proposal, approval, lock and checkout states.

The automated demonstration may create or update carts. It must stop before paid checkout.

The organizer remains the buyer and approves the final batch.

All items use the existing event delivery address.

## Tests

Add unit tests for:

* Personalization mapping validation.
* Event, party and guest source resolution.
* Date and location transforms.
* Missing required values.
* Invalid definition IDs.
* Type mismatches.
* Token visibility.
* Personalized manifest generation.
* Preservation of ordinary manifests.
* One-unit-per-recipient behavior.
* RSVP changes before batch lock.
* Existing cancellation behavior after lock.

Add agent tests using mocked model output and deterministic domain tools:

* The agent reads event context before proposing mappings.
* The agent uses retrieved product IDs and field keys.
* The agent selects a product returned by search.
* The agent creates valid mapping rows.
* The agent reports incomplete attendee coverage.
* The agent never proceeds to checkout.

Add a guarded Playwright integration test for the live Customily product:

```text
LIVE_CUSTOMILY=1
```

The test should:

1. Load the product.
2. Discover the storefront WebMCP tools.
3. Retrieve its personalization schema.
4. Configure a known location, date and caption.
5. Verify preview readiness.
6. Add the configuration to a test cart.
7. Verify the resulting cart line contains Customily data.
8. Stop before checkout.

## Definition of done

The feature is complete when:

* The organizer’s natural-language request triggers a real model call.
* The model’s tool calls are visible in traces and represented in the UI.
* Existing catalog search supplies the product candidates.
* The selected product exposes a retrievable personalization schema.
* The agent stores explicit mappings from Tokuchu data to vendor fields.
* `get_manifest` returns resolved per-attendee personalization.
* Missing data appears before vendor execution.
* A scoped vendor token reveals only the necessary RSVP definitions.
* Three attendees generate three distinct Customily configurations.
* Event date and location are shared correctly.
* Guest names and variants differ correctly.
* Customily’s own Add to Cart flow preserves production metadata.
* Execution results appear through Tokuchu’s existing vendor updates.
* The test flow stops before paid checkout.
* Existing non-personalized Tokuchu functionality continues to pass.

## Implementation constraints

* Preserve the existing TypeScript stack and project conventions.
* Reuse the OpenAI Agents SDK implementation already present in the repository.
* Reuse existing Tokuchu state transitions and operations.
* Keep model decisions structured and schema-validated.
* Keep delivery, eligibility and variant resolution deterministic.
* Keep Customily-specific DOM behavior inside the Shopify adapter.
* Keep one source of truth for manifests and gift state.
* Avoid introducing a database or external service unless the current repository already requires it.
* Preserve unrelated working-tree changes.
* Run the existing Tokuchu test suite after each major workstream.
* Document any Customily behavior that cannot be verified from the public storefront.

Before coding, produce a short implementation map that names the existing functions and types being extended. Then implement the smallest vertical slice:

1. Organizer prompt.
2. Real CurationAgent call.
3. Product selection.
4. Text-only personalization mapping.
5. Resolved manifest.
6. One personalized Customily cart item.
7. Visible vendor update.

Expand to the star-map and three-attendee flow after that slice passes.
