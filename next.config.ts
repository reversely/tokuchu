import type { NextConfig } from "next";

/**
 * The shared client ships as TypeScript source from the workspace, so Next transpiles it. PGlite
 * loads its wasm from its own package path, so Node imports it outside the bundle.
 */
const nextConfig: NextConfig = { transpilePackages: ["@webmcp/shopify-ucp"], serverExternalPackages: ["@electric-sql/pglite"] };

export default nextConfig;
