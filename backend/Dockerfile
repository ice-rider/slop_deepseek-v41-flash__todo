# syntax=docker/dockerfile:1.7
#
# FlowBoard API image.
#
# Build context is the repository root so the same context serves both images:
#   docker build -f backend/Dockerfile -t flowboard-api .

# ---------------------------------------------------------------------------
# Stage 1 — compile a static binary
# ---------------------------------------------------------------------------
FROM golang:1.25-alpine AS build

WORKDIR /src

# The pure-Go SQLite driver means no cgo; the result is a static binary that
# runs on a distroless-style runtime with no libc.
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOTOOLCHAIN=local

# Cache module downloads separately from the source so edits do not refetch.
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY backend/ ./

ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_TIME=unknown

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath \
      -ldflags "-s -w \
        -X github.com/flowboard/flowboard/backend/internal/api.Version=${VERSION} \
        -X github.com/flowboard/flowboard/backend/internal/api.Commit=${COMMIT} \
        -X github.com/flowboard/flowboard/backend/internal/api.BuildTime=${BUILD_TIME}" \
      -o /out/flowboard-server ./cmd/server

# ---------------------------------------------------------------------------
# Stage 2 — minimal runtime
# ---------------------------------------------------------------------------
FROM alpine:3.21

# ca-certificates for outbound TLS, tzdata so timestamps format sensibly.
# busybox already provides wget for the healthcheck.
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 flowboard \
    && adduser -S -u 10001 -G flowboard -h /app -s /sbin/nologin flowboard \
    && mkdir -p /data /app \
    && chown -R 10001:10001 /data /app

COPY --from=build /out/flowboard-server /usr/local/bin/flowboard-server

WORKDIR /app
USER 10001:10001

ENV FLOWBOARD_ENV=production \
    FLOWBOARD_ADDR=:8080 \
    FLOWBOARD_DB_PATH=/data/flowboard.db \
    FLOWBOARD_SEED_DEMO=false

# The SQLite database lives here; mount a volume to persist it.
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/readyz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/flowboard-server"]
