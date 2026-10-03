# FlowBoard — developer entry points.
#
# Everything here is plain `go`, `pnpm`, `docker` and `docker compose`; the
# Makefile is a convenience layer, not a requirement.
#
# The recipes assume a POSIX shell (Linux, macOS, WSL or Git Bash on Windows).

SHELL := /bin/sh

BACKEND_DIR  := backend
FRONTEND_DIR := frontend
COMPOSE      := docker compose -f deploy/docker-compose.yml
VERSION      ?= 1.0.0
COMMIT       ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo local)
# Overridden by CI and the Docker build, which pass a real timestamp.
BUILD_TIME   ?= unknown
LDFLAGS      := -s -w \
  -X github.com/flowboard/flowboard/backend/internal/api.Version=$(VERSION) \
  -X github.com/flowboard/flowboard/backend/internal/api.Commit=$(COMMIT) \
  -X github.com/flowboard/flowboard/backend/internal/api.BuildTime=$(BUILD_TIME)

.DEFAULT_GOAL := help
.PHONY: help install dev-api dev-web dev stop test test-backend test-frontend lint fmt \
        build build-backend build-frontend verify docker-env docker-build docker-up \
        docker-down docker-logs docker-reset ci clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Local development
# ---------------------------------------------------------------------------

install: ## Install frontend dependencies
	cd $(FRONTEND_DIR) && pnpm install

dev-api: ## Run the API on :8080 with a local SQLite file and demo data
	cd $(BACKEND_DIR) && \
	  FLOWBOARD_ENV=development \
	  FLOWBOARD_DB_PATH=../.localdata/flowboard.db \
	  FLOWBOARD_SEED_DEMO=true \
	  go run ./cmd/server

dev-web: ## Run the Vite dev server on :5173 (proxies /api to :8080)
	cd $(FRONTEND_DIR) && pnpm dev

dev: ## Reminder for the two-terminal workflow
	@echo "Run 'make dev-api' in one terminal and 'make dev-web' in another, then open http://localhost:5173"

# ---------------------------------------------------------------------------
# Quality gates (what CI runs)
# ---------------------------------------------------------------------------

fmt: ## Format Go sources
	cd $(BACKEND_DIR) && gofmt -w .

lint: ## Vet the backend and typecheck the frontend
	cd $(BACKEND_DIR) && go vet ./...
	cd $(FRONTEND_DIR) && pnpm run typecheck

test: test-backend test-frontend ## Run every test

test-backend: ## Go tests with the race detector
	cd $(BACKEND_DIR) && go test -race ./...

test-frontend: ## Frontend typecheck (there is no unit suite yet)
	cd $(FRONTEND_DIR) && pnpm run typecheck

ci: lint test build ## Everything CI does before building images

# ---------------------------------------------------------------------------
# Builds
# ---------------------------------------------------------------------------

build: build-backend build-frontend ## Build both artefacts

build-backend: ## Compile a static server binary into backend/bin
	cd $(BACKEND_DIR) && CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/flowboard-server ./cmd/server

build-frontend: ## Produce the production SPA bundle
	cd $(FRONTEND_DIR) && pnpm run build

# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------

docker-env: ## Create deploy/.env with a fresh secret if it does not exist
	@test -f deploy/.env || ( cp deploy/.env.example deploy/.env && \
	  sed -i.bak "s|^FLOWBOARD_JWT_SECRET=.*|FLOWBOARD_JWT_SECRET=$$(openssl rand -hex 32)|" deploy/.env && \
	  rm -f deploy/.env.bak && echo "wrote deploy/.env" )

docker-build: docker-env ## Build the api and web images
	$(COMPOSE) build

docker-up: docker-env ## Start the stack (nginx on :8080)
	$(COMPOSE) up -d --wait
	@echo "FlowBoard is on http://localhost:$${FLOWBOARD_HTTP_PORT:-8080}"

docker-down: ## Stop the stack, keeping the database volume
	$(COMPOSE) down

docker-reset: ## Stop the stack and delete the database volume
	$(COMPOSE) down -v

docker-logs: ## Follow the stack logs
	$(COMPOSE) logs -f --tail=100

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

clean: ## Remove build output (keeps dependencies)
	rm -rf $(BACKEND_DIR)/bin $(FRONTEND_DIR)/dist .localdata
