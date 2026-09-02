import type { NextConfig } from "next";

/**
 * The shared client ships as TypeScript source from the workspace, so Next transpiles it. PGlite
 * loads its wasm from its own package path, so Node imports it outside the bundle. The standalone
 * output feeds the Docker image: the store page reads its two init scripts from disk by path, which
 * the file trace cannot see, so they are listed here, and PGlite serves only the tests, so its wasm
 * stays out of the image.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@webmcp/shopify-ucp"],
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: { "/*": ["src/webmcp/polyfill.js", "integrations/customily/webmcp-customily.js"] },
  outputFileTracingExcludes: { "/*": ["node_modules/@electric-sql/pglite/**/*"] }
};

export default nextConfig;
