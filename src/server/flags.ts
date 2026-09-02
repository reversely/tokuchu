/** Feature flags read from the environment, each in one place. */

/** Whether the curation agent may run; only `LLM_ENABLED=1` or `LLM_ENABLED=true` switches it on. */
export function llmEnabled(value = process.env.LLM_ENABLED): boolean {
  return value === "1" || value === "true";
}
