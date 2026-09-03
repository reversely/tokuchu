/**
 * WebMCP merchant tools for a Customily-personalized Shopify store.
 *
 * Registers three API-backed tools on `document.modelContext`, `get_customization`,
 * `add_customized_to_cart`, and `get_order_updates`, so an agent can read a product's customization
 * fields, add configured lines through Shopify's cart endpoint, and read what became of the order
 * after checkout, from any page on the shop's origin. The tools make no DOM writes. Each supported
 * product carries one entry in PRODUCT_ADAPTERS, keyed by the numeric Shopify product id, so a new
 * product needs a new entry or a product metafield the theme exposes. A theme cannot read orders on
 * its own, so the order tool calls the order-status route Tokuchu serves for the store (ORDER_STATUS_URL).
 *
 * Install: load this file after the theme's content (see README.md). The page must expose
 * `document.modelContext` natively or through the WebMCP polyfill.
 */
(function () {
  "use strict";

  /**
   * Per-product customization. `handle` lets the tools fetch `/products/<handle>.js` for the
   * variants. `customization` lists the fields get_customization answers when the page exposes no
   * metafield; each label is the line item property name Customily reads. A product with `fields`
   * alone answers those with the same shape and no constraints.
   */
  const PRODUCT_ADAPTERS = {
    "10242071789817": {
      title: "Customized Crewneck",
      handle: "1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt",
      // The star map widget names no property for its time control, so the time label follows the
      // storefront's own location and date labels.
      customization: [
        { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
        { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} },
        { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
      ]
    },

    "10243540517113": {
      title: "Custom Dark Hoodie",
      handle: "1567-comfort-colors-garment-dyed-adult-hoodie",
      fields: {
        caption: { kind: "text", label: "Text 2", required: true },
        photo: { kind: "image", label: "Image Upload 1", required: true }
      }
    },

    "10243494084857": {
      title: "Custom Ceramic Mug",
      handle: "21504-white-15oz-ceramic-mug",
      fields: {
        photo: { kind: "image", label: "Image Upload 1", required: true }
      }
    }
  };

  /** sessionStorage prefix for the cart tool's idempotency records. */
  const IDEMPOTENCY_PREFIX = "tokuchu-customily-batch:";

  /** The line item property that carries the caller's recipient reference; the underscore hides it at checkout. */
  const RECIPIENT_PROPERTY = "_tokuchu_recipient";

  /** The tokenless Storefront GraphQL endpoint that answers a session cart's checkoutUrl. */
  const STOREFRONT_GRAPHQL = "/api/2026-04/graphql.json";

  /**
   * The order-status route Tokuchu serves for this store (#59): GET with checkout_url or cart_token
   * answers the order the checkout produced. A theme points the tool elsewhere the
   * way it exposes customization definitions: `window.__tokuchuOrderStatusUrl` or a
   * `<meta name="tokuchu-order-status-url" content="...">` tag overrides this default.
   */
  const ORDER_STATUS_URL = "https://tokuchu.onrender.com/api/store/orders";

  function orderStatusUrl() {
    if (typeof window.__tokuchuOrderStatusUrl === "string" && window.__tokuchuOrderStatusUrl) return window.__tokuchuOrderStatusUrl;
    const meta = document.querySelector('meta[name="tokuchu-order-status-url"]');
    return meta && meta.content ? meta.content : ORDER_STATUS_URL;
  }

  /** Value shapes per customization kind; a kind absent here accepts any non-empty string. */
  const KIND_SHAPES = {
    date: { pattern: /^\d{4}-\d{2}-\d{2}$/, message: "date must be YYYY-MM-DD" },
    time: { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "time must be HH:MM in 24-hour form" },
    image: { pattern: /^(https:|data:image\/)/, message: "send an https URL or an image data URL" }
  };

  function result(payload, isError) {
    const out = { content: [{ type: "text", text: JSON.stringify(payload) }] };
    if (isError) out.isError = true;
    return out;
  }

  function fail(message, extra) {
    return result(Object.assign({ error: message }, extra || {}), true);
  }

  /**
   * The bare numeric Shopify product id from either form: PRODUCT_ADAPTERS and the product page's id
   * input both key on the number, while a UCP catalog carries the full "gid://shopify/Product/<n>".
   * Every tool normalizes its product_id argument through this so a caller may pass either form.
   */
  function bareProductId(id) {
    return String(id == null ? "" : id).replace(/^gid:\/\/shopify\/Product\//, "");
  }

  /**
   * The product's variants and options from the storefront's own JSON endpoint: a read from any
   * page on the shop's origin. Returns null when the endpoint does not answer, and the caller
   * turns that into an isError result.
   */
  async function fetchProductJson(adapter, signal) {
    try {
      const res = await fetch("/products/" + adapter.handle + ".js", { signal: signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  /* ---- idempotency (sessionStorage keyed to the idempotency_key) ---- */

  // The record is keyed on idempotency_key alone, not on the cart token: Shopify rotates the cart
  // token when the first line is added to an empty cart (verified live on 2026-08-31), so a
  // token-scoped key written before the first add is unfindable on the replay call. Cart identity
  // is instead re-checked on replay against the live cart lines (cartKeys.has below), so a cleared
  // or replaced cart re-adds rather than replaying a stale line.
  function idempotencyStorageKey(idempotencyKey) {
    return IDEMPOTENCY_PREFIX + idempotencyKey;
  }

  /** The recorded recipient-to-line map for this key, or an empty object. */
  function readIdempotencyRecord(idempotencyKey) {
    try {
      const raw = sessionStorage.getItem(idempotencyStorageKey(idempotencyKey));
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function writeIdempotencyRecord(idempotencyKey, record) {
    try {
      sessionStorage.setItem(idempotencyStorageKey(idempotencyKey), JSON.stringify(record));
    } catch (err) {
      // A full or blocked sessionStorage weakens the replay guard; the add itself already happened.
    }
  }

  async function fetchCart(signal) {
    try {
      const res = await fetch("/cart.js", { signal: signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  /* ---- customization (reads and cart adds through Shopify's endpoints, no DOM selector) ---- */

  /**
   * Customization definitions the theme exposes on the page: `window.__tokuchuCustomization` or a
   * `<script type="application/json" id="tokuchu-customization">` block, either holding a map from
   * product id to { title, fields }. Returns an empty object when the page exposes neither.
   */
  function pageCustomization() {
    if (window.__tokuchuCustomization && typeof window.__tokuchuCustomization === "object") return window.__tokuchuCustomization;
    const block = document.getElementById("tokuchu-customization");
    if (!block) return {};
    try {
      return JSON.parse(block.textContent) || {};
    } catch (err) {
      return {};
    }
  }

  function fieldFromAdapter(key, field) {
    const constraints = {};
    if (field.max_length) constraints.max_length = field.max_length;
    return { key: key, label: field.label, kind: field.kind, required: !!field.required, constraints: constraints };
  }

  /** The customization fields for a product: the page's definition, then the adapter's, then its DOM fields. */
  function customizationFields(productId, adapter) {
    const exposed = pageCustomization()[productId];
    if (exposed && Array.isArray(exposed.fields)) return exposed.fields;
    if (adapter.customization) return adapter.customization;
    return Object.keys(adapter.fields).map(function (key) { return fieldFromAdapter(key, adapter.fields[key]); });
  }

  function variantSummary(productJson, variant) {
    const options = productJson.options.map(function (option, i) { return { name: option.name, label: variant.options[i] }; });
    return { id: String(variant.id), title: variant.title, price_cents: variant.price, available: !!variant.available, options: options };
  }

  /** Issues with one value against its field; an empty list means the value fits. */
  function valueIssues(field, value) {
    if (typeof value !== "string" || value.length === 0) return ["value must be a non-empty string"];
    const issues = [];
    const constraints = field.constraints || {};
    if (constraints.max_length && value.length > constraints.max_length) issues.push("value exceeds " + constraints.max_length + " characters");
    if (constraints.options && constraints.options.indexOf(value) === -1) issues.push("value is outside " + constraints.options.join(", "));
    const shape = KIND_SHAPES[field.kind];
    if (shape && !shape.pattern.test(value)) issues.push(shape.message);
    return issues;
  }

  /**
   * Validates one cart item against its product's fields and variants. `variantIndex` maps a
   * variant id to its product entry, so an item needs no product_id of its own.
   */
  function customizedItemIssues(item, variantIndex) {
    const issues = [];
    if (!item.recipient_ref || typeof item.recipient_ref !== "string") issues.push({ message: "recipient_ref must be a non-empty string" });
    const entry = variantIndex.get(String(item.variant_id));
    if (!entry) {
      issues.push({ message: "variant_id " + JSON.stringify(String(item.variant_id)) + " matches no variant of the adapted products" });
      return issues;
    }
    const byKey = new Map(entry.fields.map(function (f) { return [f.key, f]; }));
    const values = item.values && typeof item.values === "object" ? item.values : {};
    for (const key of Object.keys(values)) {
      const field = byKey.get(key);
      if (!field) {
        issues.push({ field_key: key, message: "unknown field" });
        continue;
      }
      for (const message of valueIssues(field, values[key])) issues.push({ field_key: key, message: message });
    }
    for (const field of entry.fields) {
      if (field.required && values[field.key] === undefined) issues.push({ field_key: field.key, message: "required and no value supplied" });
    }
    return issues;
  }

  /** Every adapted product's variants keyed by variant id, with the product's fields beside each. */
  async function buildVariantIndex(signal) {
    const ids = Object.keys(PRODUCT_ADAPTERS);
    const products = await Promise.all(ids.map(function (id) { return fetchProductJson(PRODUCT_ADAPTERS[id], signal); }));
    const index = new Map();
    ids.forEach(function (id, i) {
      if (!products[i]) return;
      const fields = customizationFields(id, PRODUCT_ADAPTERS[id]);
      for (const variant of products[i].variants) index.set(String(variant.id), { product_id: id, fields: fields });
    });
    return { index: index, unanswered: ids.filter(function (id, i) { return !products[i]; }) };
  }

  /** The line item properties for one item, keyed by the labels Customily reads. */
  function lineProperties(item, fields) {
    const properties = {};
    for (const field of fields) {
      if (item.values[field.key] !== undefined) properties[field.label] = item.values[field.key];
    }
    properties[RECIPIENT_PROPERTY] = item.recipient_ref;
    return properties;
  }

  /** Adds one line through /cart/add.js; returns { key, variant_id } or { error }. */
  async function addCartLine(variantId, properties, signal) {
    try {
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1, properties: properties }] }),
        signal: signal
      });
      const body = await res.json();
      if (!res.ok) return { error: body.description || body.message || ("the cart endpoint answered " + res.status) };
      const line = Array.isArray(body.items) ? body.items[0] : body;
      if (!line || !line.key) return { error: "the cart endpoint returned no line" };
      return { key: line.key, variant_id: String(line.variant_id) };
    } catch (err) {
      return { error: "the cart endpoint did not answer with JSON" };
    }
  }

  /**
   * The cart's shareable checkout URL: the session cart's token is a Storefront cart id, and the
   * tokenless GraphQL endpoint answers its checkoutUrl, which opens the same cart at checkout in
   * any browser. Returns null when the endpoint does not answer.
   */
  async function fetchCheckoutUrl(cartToken, signal) {
    try {
      const res = await fetch(STOREFRONT_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "query($id:ID!){cart(id:$id){checkoutUrl}}", variables: { id: "gid://shopify/Cart/" + cartToken } }),
        signal: signal
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body.data && body.data.cart ? body.data.cart.checkoutUrl : null;
    } catch (err) {
      return null;
    }
  }

  const SCHEMA_CUSTOMIZED_ITEMS = {
    type: "array",
    description: "The customized items to add, one cart line each",
    items: {
      type: "object",
      properties: {
        recipient_ref: { type: "string", description: "The caller's stable reference for the recipient this item belongs to" },
        variant_id: { type: "string", description: "The numeric Shopify variant id for this item" },
        values: { type: "object", description: "Field key to value, using the keys from get_customization" }
      },
      required: ["recipient_ref", "variant_id", "values"]
    }
  };

  const CUSTOMIZATION_TOOLS = [
    {
      name: "get_customization",
      description:
        "Returns the customization contract of a product on this shop: each field's key, label, kind (text, name, location, date, time, image), required flag, and constraints such as max_length or options, plus the product's variants with price and availability from the storefront's product JSON. Call this before add_customized_to_cart.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "The numeric Shopify product id" }
        },
        required: ["product_id"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const productId = bareProductId(args.product_id);
        const adapter = PRODUCT_ADAPTERS[productId];
        if (!adapter) return fail("no customization for product " + JSON.stringify(String(productId)), { known_product_ids: Object.keys(PRODUCT_ADAPTERS) });
        const productJson = await fetchProductJson(adapter, signal);
        if (!productJson) return fail("the storefront's product JSON did not answer; retry from a page on the shop's origin");
        const variants = productJson.variants.map(function (v) { return variantSummary(productJson, v); });
        const selected = variants.find(function (v) { return v.available; }) || variants[0] || null;
        const exposed = pageCustomization()[productId];
        return result({
          product_id: productId,
          title: exposed && exposed.title ? exposed.title : productJson.title || adapter.title,
          fields: customizationFields(productId, adapter),
          variants: variants,
          selected_variant_id: selected ? selected.id : null
        });
      }
    },

    {
      name: "add_customized_to_cart",
      description:
        "Adds one cart line per customized item through Shopify's cart endpoint, with the values as line item properties. Every item is validated against its product's fields first; if any item fails, the per-item issues come back and nothing is added. Returns the ready lines, the cart subtotal and currency, and a checkout_url that opens this cart at checkout in any browser. A repeated call with the same idempotency_key adds nothing.",
      inputSchema: {
        type: "object",
        properties: {
          batch_id: { type: "string", description: "The caller's stable id for this batch; defaults to the idempotency_key" },
          items: SCHEMA_CUSTOMIZED_ITEMS,
          idempotency_key: { type: "string", description: "A caller-chosen key; a repeated call with the same key on the same cart re-adds nothing" }
        },
        required: ["items", "idempotency_key"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        if (!Array.isArray(args.items) || args.items.length === 0) return fail("items must be a non-empty array");
        if (!args.idempotency_key || typeof args.idempotency_key !== "string") return fail("idempotency_key must be a non-empty string");
        const items = args.items.map(function (item) { return item && typeof item === "object" ? item : {}; });
        const refs = new Set();
        for (const item of items) {
          if (refs.has(item.recipient_ref)) return fail("recipient_ref " + JSON.stringify(item.recipient_ref) + " appears twice in items");
          refs.add(item.recipient_ref);
        }

        const catalog = await buildVariantIndex(signal);
        if (catalog.index.size === 0) return fail("the storefront's product JSON did not answer; retry from a page on the shop's origin", { unanswered_product_ids: catalog.unanswered });
        const validation = items.map(function (item) { return { recipient_ref: item.recipient_ref || null, issues: customizedItemIssues(item, catalog.index) }; });
        if (validation.some(function (v) { return v.issues.length > 0; })) {
          return fail("one or more items are invalid and nothing was added", { items: validation });
        }

        // A failed before-cart read returns here: nothing has been added yet, so a retry is safe.
        const cartBefore = await fetchCart(signal);
        if (!cartBefore) return fail("the cart did not answer with JSON before the add; retry");
        const record = readIdempotencyRecord(args.idempotency_key);
        const cartKeys = new Set(cartBefore.items.map(function (i) { return i.key; }));

        const ready = [];
        const blocked = [];
        for (const item of items) {
          const recipient = item.recipient_ref;
          if (record[recipient] && cartKeys.has(record[recipient])) {
            ready.push({ recipient_ref: recipient, cart_line_key: record[recipient], variant_id: String(item.variant_id), replayed: true });
            continue;
          }
          const entry = catalog.index.get(String(item.variant_id));
          const added = await addCartLine(item.variant_id, lineProperties(item, entry.fields), signal);
          if (added.error) {
            blocked.push({ recipient_ref: recipient, issues: [{ message: added.error }] });
            continue;
          }
          record[recipient] = added.key;
          cartKeys.add(added.key);
          writeIdempotencyRecord(args.idempotency_key, record);
          ready.push({ recipient_ref: recipient, cart_line_key: added.key, variant_id: added.variant_id });
        }

        const cartAfter = (await fetchCart(signal)) || cartBefore;
        const checkoutUrl = cartAfter.token ? await fetchCheckoutUrl(cartAfter.token, signal) : null;
        return result({
          batch_id: args.batch_id || args.idempotency_key,
          status: "prepared",
          ready: ready,
          blocked: blocked,
          subtotal: cartAfter.items_subtotal_price,
          currency: cartAfter.currency,
          checkout_url: checkoutUrl
        }, ready.length === 0);
      }
    },

    {
      name: "get_order_updates",
      description:
        "Returns what became of a checkout add_customized_to_cart produced: the order's name and id, created_at, financial_status, fulfillment_status, one line item per cart line with its recipient_ref and the personalization values from its line properties, the fulfillments with tracking company, number, and url, and the last update time. A checkout with no order yet returns { status: \"not_ordered\" }. Pass checkout_url or cart_token or order_name; with none, this session's cart token is read from /cart.js.",
      inputSchema: {
        type: "object",
        properties: {
          checkout_url: { type: "string", description: "The checkout_url add_customized_to_cart returned" },
          cart_token: { type: "string", description: "The cart token the checkout URL names" },
        },
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const params = new URLSearchParams();
        if (args.checkout_url) params.set("checkout_url", String(args.checkout_url));
        else if (args.cart_token) params.set("cart_token", String(args.cart_token));
        else {
          const cart = await fetchCart(signal);
          if (!cart || !cart.token) return fail("the cart did not answer with a token; pass checkout_url or cart_token");
          params.set("cart_token", cart.token);
        }
        try {
          const res = await fetch(orderStatusUrl() + "?" + params.toString(), { headers: { Accept: "application/json" }, signal: signal });
          const body = await res.json();
          if (!res.ok) return fail(body.error || ("the order route answered " + res.status));
          return result(body);
        } catch (err) {
          return fail("the order route at " + orderStatusUrl() + " did not answer with JSON");
        }
      }
    }
  ];

  function register() {
    if (!document.modelContext) {
      console.warn("webmcp-customily: document.modelContext is unavailable so no tools are registered");
      return;
    }
    const controller = new AbortController();
    window.__gatherCustomilyAbort = controller;
    for (const tool of CUSTOMIZATION_TOOLS) {
      Promise.resolve(document.modelContext.registerTool(tool, { signal: controller.signal })).catch(function (err) {
        console.warn("webmcp-customily: registering " + tool.name + " failed", err);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register, { once: true });
  } else {
    register();
  }
})();
