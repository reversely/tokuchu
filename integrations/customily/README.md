# Customily WebMCP merchant tools

`webmcp-customily.js` registers two tools on `document.modelContext` on every page of the store, so a browser agent can read a product's customization fields and add configured lines to the cart through Shopify's cart endpoint. The tools make no DOM writes. Each supported product carries one entry in the `PRODUCT_ADAPTERS` map at the top of the file, keyed by the numeric Shopify product id, so supporting a new product means adding one entry or one product metafield. The script also still registers the three older batch tools (`get_personalization_schema`, `validate_personalized_batch`, `create_personalized_batch`) until issue #12 removes them once the app stops calling them; those drive the Customily widget through DOM selectors and run only on the product's own page.

## Installation in the Shopify theme

1. In the Shopify admin open Online Store, then Themes, then Edit code.
2. Upload `webmcp-customily.js` to the theme's `assets` folder.
3. Load it on every page by adding this line before `</body>` in `layout/theme.liquid`:

   ```liquid
   <script src="{{ 'webmcp-customily.js' | asset_url }}" defer></script>
   ```

4. The page needs `document.modelContext`. A browser with native WebMCP support provides it; a headless driver injects `src/webmcp/polyfill.js` before the page scripts run. Shopify's own storefront WebMCP script registers its search, product, and cart tools under the same condition.

## Field definitions

`get_customization` reads a product's fields from the first of three sources that answers: a page-level definition the theme exposes, the `customization` list on the product's `PRODUCT_ADAPTERS` entry, and the entry's DOM field map. The theme exposes a definition as `window.__tokuchuCustomization` or as a `<script type="application/json" id="tokuchu-customization">` block; either holds a map from product id to `{ title, fields }`, so a metafield rendered by Liquid reaches the tool with no script change:

```liquid
<script type="application/json" id="tokuchu-customization">
  { "{{ product.id }}": { "title": {{ product.title | json }}, "fields": {{ product.metafields.tokuchu.customization.value | json }} } }
</script>
```

## Tools

### get_customization

Takes `{ product_id }`. Returns the product's customization contract: each field's key, label, kind (`text`, `name`, `location`, `date`, `time`, `image`), required flag, and `constraints` such as `max_length` or `options`, plus the product's variants read from `/products/{handle}.js` with `id`, `title`, `price_cents`, `available`, and `options` as `{ name, label }` pairs, and `selected_variant_id`, the first available variant. The demo crewneck returns a star map location, a star map time, and a name limited to 20 characters, and six size variants.

### add_customized_to_cart

Takes `{ items, idempotency_key, batch_id? }`. Each item is `{ recipient_ref, variant_id, values }`, where `values` maps field keys from `get_customization` to strings; the variant id names the product, so the call carries no `product_id`. The tool validates every item first: an unknown key, a missing required value, a value over its `max_length` or outside its `options`, a date outside `YYYY-MM-DD`, a time outside `HH:MM`, or a variant id that resolves against none of the adapted products returns `isError` with the per-item issues and adds nothing. It then adds one line per item through `/cart/add.js`, with each value stored as a line item property under the field's label (the name Customily reads, such as `Text 2`) plus `_tokuchu_recipient` holding the `recipient_ref`, reads the session cart's token from `/cart.js`, and returns `{ batch_id, status: "prepared", ready, blocked, subtotal, currency, checkout_url }`. `batch_id` defaults to the `idempotency_key`. `checkout_url` is the cart's `checkoutUrl` (`/cart/c/{token}?key=...`) as the tokenless Storefront GraphQL endpoint (`/api/2026-04/graphql.json`, cart id `gid://shopify/Cart/{token}`) answers it, which opens the cart at Shopify's checkout in any browser with every line and its properties.

Idempotency: after each successful add the tool records `recipient_ref` to cart-line-key in `sessionStorage` under the `idempotency_key`, and re-checks the recorded lines against the live `/cart.js` on replay. A repeated call with the same key returns the recorded lines with `replayed: true` and adds nothing.

## Fulfillment

Customily reads the line item properties on the order to produce the print file. A test order from an API-added line confirms that path for the demo store; the order has not been placed yet, and the result goes on issue #11 when it runs.

## Testing

`tests/customily-tools-live.spec.ts` tests the two tools against the live storefront. It runs only with `LIVE_CUSTOMILY=1`, adds two lines on the crewneck, opens the returned `checkout_url` in a fresh browser context, asserts both lines with their names, and verifies the idempotency replay adds nothing:

```sh
LIVE_CUSTOMILY=1 npx playwright test tests/customily-tools-live.spec.ts
```

`tests/customily-live.spec.ts` covers the three older tools under the same gate.
