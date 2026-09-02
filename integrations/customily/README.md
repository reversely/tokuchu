# Customily WebMCP merchant tools

`webmcp-customily.js` registers two tools on `document.modelContext` on every page of the store, so a browser agent can read a product's customization fields and add configured lines to the cart through Shopify's cart endpoint. The tools make no DOM writes. Each supported product carries one entry in the `PRODUCT_ADAPTERS` map at the top of the file, keyed by the numeric Shopify product id, so supporting a new product means adding one entry or one product metafield. Issue #11 brings the script to this contract.

## Installation in the Shopify theme

1. In the Shopify admin open Online Store, then Themes, then Edit code.
2. Upload `webmcp-customily.js` to the theme's `assets` folder.
3. Load it on every page by adding this line before `</body>` in `layout/theme.liquid`:

   ```liquid
   <script src="{{ 'webmcp-customily.js' | asset_url }}" defer></script>
   ```

4. The page needs `document.modelContext`. A browser with native WebMCP support provides it; a headless driver injects `src/webmcp/polyfill.js` before the page scripts run. Shopify's own storefront WebMCP script registers its search, product, and cart tools under the same condition.

## Tools

### get_customization

Takes `{ product_id }`. Returns the product's customization contract: each field's key, label, kind (`text`, `name`, `location`, `date`, `image`), required flag, and constraints such as `max_length`, plus the product's variants read from `/products/{handle}.js`. The demo crewneck returns a star map location, a star map date, and a name limited to 20 characters, and six size variants.

### add_customized_to_cart

Takes `{ items, idempotency_key }`. Each item is `{ recipient_ref, variant_id, values }`, where `values` maps field keys from `get_customization` to strings. The tool validates every item first: an unknown key, a missing required value, a value over its `max_length`, a date outside `YYYY-MM-DD`, or a variant id that does not resolve returns the item's issues and adds nothing. It then adds one line per item through `/cart/add.js` with the values as line item properties, reads the session cart's Storefront id from `/cart.js`, and returns `{ ready, blocked, subtotal, currency, checkout_url }`. `checkout_url` is the cart's `checkoutUrl` (`/cart/c/{token}?key=...`), which opens the cart at Shopify's checkout in any browser with every line and its properties.

Idempotency: after each successful add the tool records `recipient_ref` to cart-line-key in `sessionStorage` under the `idempotency_key`, and re-checks the recorded lines against the live `/cart.js` on replay. A repeated call with the same key returns the recorded lines with `replayed: true` and adds nothing.

## Fulfillment

Customily reads the line item properties on the order to produce the print file. A test order from an API-added line confirms that path for the demo store; the result is recorded on issue #11.

## Testing

`tests/customily-live.spec.ts` smoke-tests the tools against the live storefront. It runs only with `LIVE_CUSTOMILY=1`, adds two lines on the crewneck, opens the returned `checkout_url` in a fresh browser context, asserts both lines with their names, and verifies the idempotency replay adds nothing:

```sh
LIVE_CUSTOMILY=1 npx playwright test tests/customily-live.spec.ts
```
