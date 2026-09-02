import { defineConfig, devices } from "@playwright/test";

/** The sign-in suite's organizer joins whatever `ORGANIZER_EMAILS` the shell already carries. */
const organizerEmails = [process.env.ORGANIZER_EMAILS, "organizer@example.com"].filter(Boolean).join(",");

/** The WebMCP suite runs against this app's dev server on port 3113; a server already listening there is reused. */
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3113", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npm run dev -- -p 3113", url: "http://localhost:3113/", reuseExistingServer: true, timeout: 120_000, env: { ORGANIZER_EMAILS: organizerEmails } }
});
