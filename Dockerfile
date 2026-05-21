# syntax=docker/dockerfile:1
#
# Single-stage build: install the workspace, build types -> frontend -> backend,
# and run the bundled backend, which serves the built SPA, the REST API, and the
# WebSocket endpoints on one port. This mirrors the verified local production run
# (`node packages/backend/dist/server.js`) exactly.

FROM node:20-bookworm-slim
WORKDIR /app

# pnpm via the bundled corepack.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install dependencies first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/eval/package.json packages/eval/
RUN pnpm install --frozen-lockfile

# Build all packages (types must build before backend/frontend consume it).
COPY . .
RUN pnpm --filter @workbench/types build \
  && pnpm --filter @workbench/frontend build \
  && pnpm --filter @workbench/backend build

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

EXPOSE 3001
CMD ["node", "packages/backend/dist/server.js"]
