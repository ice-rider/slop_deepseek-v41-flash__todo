# UI verification harness

Drives the real FlowBoard UI in a headless browser and fails on console errors,
page errors or failed requests. This is what produced the screenshots in
[`../../docs/screenshots`](../../docs/screenshots), and it is the check that
caught the realtime-publishing bug described in the main README.

It uses **`playwright-core` with your installed Chrome or Edge**, so nothing
downloads a browser.

## Setup

```bash
cd tools/ui-verify
pnpm install
```

Point it at a browser if the defaults are wrong for your machine:

```bash
# Windows defaults
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"   # or msedge.exe
# macOS
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux
CHROME_PATH="/usr/bin/google-chrome"
```

## Running against the dev servers

Start the API and the Vite dev server first (`make dev-api`, `make dev-web`),
then:

```bash
pnpm run verify          # http://localhost:5173
```

Override the targets with `APP_URL` / `API_URL` if they are not on the defaults.

## Running against the container image

Start the stack (`make docker-up`), then:

```bash
pnpm run verify:docker   # http://localhost:8090
```

This variant is the stronger check: it exercises the built bundle served by
nginx with the API behind the same origin, exactly as in production.

## What each script covers

`verify.mjs` — dashboard, board rendering, both themes, the inline composer via
the `n` shortcut, the card drawer, the command palette, a simulated drag that is
then confirmed through the API, search, my-work, the board gallery, settings and
the sign-in screen.

`verify-docker.mjs` — the containerised build: dashboard and board render from
the image, a card created through the UI is confirmed persisted by the API, and
the realtime indicator reports the SSE stream as live.

`smoke.mjs` — a two-second sanity check that the browser launches and the
sign-in screen renders.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:5173` | Where the app is served |
| `API_URL` | `http://localhost:8080/api/v1` | API base (dev script only) |
| `CHROME_PATH` | Windows Chrome path | Browser executable |

Screenshots are written to `shots/`. The scripts exit non-zero when they find a
problem, with the offending console lines printed.
