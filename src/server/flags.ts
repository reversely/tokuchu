/** Feature flags read from the environment, each in one place. */

/**
 * Whether the server runs as a records app for a browser agent (#56): `TOKUCHU_STATIC=1` or
 * `TOKUCHU_STATIC=true`. In static mode the server never opens the store's pages itself; the
 * agent reads the product's customization on the store's page and hands it to Tokuchu, and
 * takes the manifest's cart items back to the store's page.
 */
export function staticMode(value = process.env.TOKUCHU_STATIC): boolean {
  return value === "1" || value === "true";
}

/** Whether the curation agent may run; only `LLM_ENABLED=1` or `LLM_ENABLED=true` switches it on, and static mode keeps it off. */
export function llmEnabled(value = process.env.LLM_ENABLED, isStatic = staticMode()): boolean {
  return !isStatic && (value === "1" || value === "true");
}
