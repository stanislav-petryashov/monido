# Build: client in dist/client, server in dist/server/main.js (one file plus the lazily loaded locale files in dist/server/assets/: Russian, and each locale chunk the bot words its texts from).
# It runs once, on the build machine's platform, and every target copies the same dist: dist is plain JS (the server
# bundles its dependencies, node:sqlite is built in, no native addon), so a multi-arch build runs npm ci and vite natively,
# not under QEMU for arm64
# The base pinned by version and multi-arch index digest (Dependabot's docker updates move both): a rebuild of the
# same commit gets the same Node and Alpine
FROM --platform=$BUILDPLATFORM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# .dockerignore lets in only what the build reads
COPY . .
# no tsc here: docker.yml publishes only after its check job (npm run check, tsc -b included) passed on the same commit
RUN npx vite build && npx vite build --config vite.server.config.ts

# Runtime: one per target platform; only dist and schema.sql, no node_modules; data in /data
FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 HOST=0.0.0.0
COPY --from=build /app/dist ./dist
COPY schema.sql ./schema.sql
# last, so a new version does not invalidate the layers above
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN mkdir -p /data && chown node:node /data
# the reset-password command: `docker compose exec app reset-password`
COPY --chmod=755 deploy/docker/reset-password /usr/local/bin/reset-password
# the advisor over stdio for Claude Desktop/Code: `docker compose exec -T app monido-mcp`
COPY --chmod=755 deploy/docker/monido-mcp /usr/local/bin/monido-mcp
USER node
VOLUME /data
EXPOSE 8080
# shell form: the port comes from PORT if it was overridden at launch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1
CMD ["node", "dist/server/main.js"]
