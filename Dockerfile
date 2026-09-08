# ─────────────────────────────────────────────────────────────────────────────
# ROOT DOCKERFILE — deployment convenience only.
#
# This is a copy of origin/Dockerfile placed at the repo root because some
# hosts (Railway) auto-detect a root Dockerfile and will otherwise try to
# guess how to build this monorepo (and guess wrong).
#
# Local development does NOT use this file — docker-compose.yml points each
# service at its own Dockerfile (origin/Dockerfile, edge/Dockerfile, etc.).
#
# If you change origin/Dockerfile, change this too, or delete this file once
# your host is configured to use origin/Dockerfile explicitly.
# ─────────────────────────────────────────────────────────────────────────────

# Build context is the repo root so this can install the npm workspace
# (shared + origin) together.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY origin/package.json origin/
RUN npm install --workspaces --if-present --include-workspace-root
COPY tsconfig.base.json ./
COPY shared shared
COPY origin origin
RUN npm run build --workspace=@minicdn/shared
RUN npm run build --workspace=origin

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/origin ./origin
WORKDIR /app/origin
EXPOSE 4000
CMD ["sh", "-c", "node dist/seed.js 2>/dev/null; node dist/server.js"]
