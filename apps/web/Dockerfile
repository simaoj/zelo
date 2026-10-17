# syntax=docker/dockerfile:1.7
# Zelo web (Next.js standalone). Build context = repo root:
#   docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:4000 .
#
# NOTE: Next.js resolves `rewrites()` at BUILD time and stores them in the routes manifest,
# so API_INTERNAL_URL (the server-side target of /api/* → backend) must be provided as a
# build arg. The runtime ENV only documents the value; changing it requires a rebuild.
# No secrets here: it is an internal URL, never exposed to the browser (no NEXT_PUBLIC_*).
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- build: contracts + web ----------
FROM ${NODE_IMAGE} AS build
ARG API_INTERNAL_URL=http://api:4000
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=${API_INTERNAL_URL}
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@zelo/web..."
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @zelo/contracts build && pnpm --filter @zelo/web build

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ARG API_INTERNAL_URL=http://api:4000
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 API_INTERNAL_URL=${API_INTERNAL_URL}
WORKDIR /app
# standalone output is rooted at the monorepo (server at apps/web/server.js)
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/entrar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
