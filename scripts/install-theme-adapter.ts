/**
 * Installs the merchant WebMCP tools in the store's live theme through the Admin API (#14): uploads
 * integrations/customily/webmcp-customily.js as a theme asset and adds its script tag before
 * </body> in layout/theme.liquid. The previous layout is written beside this script's output so
 * the change can be undone by upserting it back.
 *
 * Run from the repo root with the Shopify Admin keys in .env:
 *   npx tsx scripts/install-theme-adapter.ts
 * Pass --dry-run to print what would change without writing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { adminGraphql } from "../src/server/shopify-admin";

const ASSET = "assets/webmcp-customily.js";
const LAYOUT = "layout/theme.liquid";
const TAG = `    <script src="{{ 'webmcp-customily.js' | asset_url }}" defer></script>\n`;

type ThemeFiles = { themes: { nodes: { id: string; name: string; role: string; files: { nodes: { filename: string; body: { content?: string } }[] } }[] } };
type Upsert = { themeFilesUpsert: { upsertedThemeFiles: { filename: string }[]; userErrors: { code: string; filename: string; message: string }[] } };

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const data = await adminGraphql<ThemeFiles>(
    `{ themes(first: 10, roles: [MAIN]) { nodes { id name role files(filenames: ["${LAYOUT}", "${ASSET}"]) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } } }`
  );
  const theme = data.themes.nodes[0];
  if (!theme) throw new Error("The store has no published theme.");
  const layout = theme.files.nodes.find((f) => f.filename === LAYOUT)?.body.content;
  if (!layout) throw new Error(`${theme.name} has no ${LAYOUT}.`);
  const backup = `theme.liquid.${Date.now()}.backup`;
  writeFileSync(backup, layout);
  console.info(`Theme ${theme.name} (${theme.role}); previous layout saved to ${backup}.`);

  const asset = readFileSync("integrations/customily/webmcp-customily.js", "utf8");
  const end = layout.lastIndexOf("</body>");
  if (end < 0) throw new Error(`${LAYOUT} has no </body>.`);
  const alreadyTagged = layout.includes("webmcp-customily.js");
  const nextLayout = alreadyTagged ? layout : layout.slice(0, end) + TAG + layout.slice(end);
  console.info(alreadyTagged ? "The layout already loads the asset; only the asset is refreshed." : "The layout gains the script tag before </body>.");
  if (dryRun) return;

  const result = await adminGraphql<Upsert>(
    `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { code filename message } } }`,
    { themeId: theme.id, files: [{ filename: ASSET, body: { type: "TEXT", value: asset } }, { filename: LAYOUT, body: { type: "TEXT", value: nextLayout } }] }
  );
  const errors = result.themeFilesUpsert.userErrors;
  if (errors.length) throw new Error(errors.map((e) => `${e.filename}: ${e.code} ${e.message}`).join("; "));
  console.info(`Upserted ${result.themeFilesUpsert.upsertedThemeFiles.map((f) => f.filename).join(" and ")}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
