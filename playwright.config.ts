import { defineConfig, devices } from "@playwright/test";

/** The sign-in suite's organizer joins whatever `ORGANIZER_EMAILS` the shell already carries. */
const organizerEmails = [process.env.ORGANIZER_EMAILS, "organizer@example.com"].filter(Boolean).join(",");

/**
 * The suites run against this app's dev server: port 3113 in normal mode and 3114 with
 * `TOKUCHU_STATIC=1` in the shell, so a static-mode run (tests/static-agent.spec.ts, #56) never
 * reuses a normal server. `PW_PORT` overrides either. A server already listening on the port is reused,
 * and the dev server inherits the shell's environment, so the flag reaches it.
 */
const isStatic = process.env.TOKUCHU_STATIC === "1" || process.env.TOKUCHU_STATIC === "true";
const port = Number(process.env.PW_PORT ?? (isStatic ? 3114 : 3113));

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: `npm run dev -- -p ${port}`, url: `http://localhost:${port}/`, reuseExistingServer: true, timeout: 120_000, env: { ORGANIZER_EMAILS: organizerEmails } }
});
