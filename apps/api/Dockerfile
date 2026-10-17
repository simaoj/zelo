# syntax=docker/dockerfile:1.7
# Zelo API (also used for the worker and migrate services). Build context = repo root.
#   docker build -f apps/api/Dockerfile .
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- build: contracts + api ----------
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@zelo/api..."
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @zelo/contracts build && pnpm --filter @zelo/api build

# ---------- production dependencies only ----------
FROM ${NODE_IMAGE} AS prod-deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@zelo/api..."

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
# compose overrides the command for the worker (apps/api/dist/bootstrap/worker.js) and migrate (…/migrate.js)
CMD ["node", "apps/api/dist/bootstrap/main.js"]
