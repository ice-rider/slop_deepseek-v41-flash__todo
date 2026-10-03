# syntax=docker/dockerfile:1.7
#
# FlowBoard web image: builds the SPA, then serves it from nginx, which also
# reverse-proxies the API. Build context is the repository root:
#   docker build -f frontend/Dockerfile -t flowboard-web .

# ---------------------------------------------------------------------------
# Stage 1 — build the SPA
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

# Pin pnpm explicitly instead of relying on Corepack's "latest known" version,
# which would silently change between builds.
ARG PNPM_VERSION=10.30.3
RUN npm install --global pnpm@${PNPM_VERSION} && pnpm --version

# Dependency layer: only invalidated when the manifests change.
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
    && pnpm install --frozen-lockfile

COPY frontend/ ./

# The API is reached through this same origin (/api), so no build-time URL is
# needed; override with --build-arg VITE_API_BASE=... for split deployments.
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=${VITE_API_BASE}
RUN pnpm run build

# ---------------------------------------------------------------------------
# Stage 2 — nginx (unprivileged): static files + reverse proxy
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root

# Replace the stock configuration with the FlowBoard edge config, which adds
# security headers, gzip, rate limiting and an unbuffered route for SSE.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/ /etc/nginx/
COPY --from=build /app/dist /usr/share/nginx/html

# Back to the image's non-root UID (101).
USER 101

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/healthz >/dev/null || exit 1

STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
