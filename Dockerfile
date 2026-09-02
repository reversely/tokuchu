# The Playwright image carries Node 24, Chromium, and its system libraries at the version
# `package-lock.json` pins for `@playwright/test`; the tag must move with that version or the
# approval job's browser launch fails at runtime.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shopify-ucp/package.json packages/shopify-ucp/
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# The migration entry compiles to one file so the runtime stage needs neither tsx nor the sources;
# `pg` stays external and resolves from the traced node_modules beside it.
RUN npx esbuild scripts/migrate.ts --bundle --platform=node --format=esm --packages=external --outfile=.next/standalone/migrate.mjs

FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Docker sets HOSTNAME to the container id; the standalone server binds to it, so it is pinned to all interfaces.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=pwuser:pwuser /app/.next/standalone ./
COPY --from=build --chown=pwuser:pwuser /app/.next/static ./.next/static
COPY --from=build --chown=pwuser:pwuser /app/public ./public
USER pwuser
EXPOSE 3000
CMD ["node", "server.js"]
