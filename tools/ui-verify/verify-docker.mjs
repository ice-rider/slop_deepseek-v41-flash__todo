/**
 * Verify the containerised deployment: nginx serves the built SPA and proxies
 * the API, exactly as it will in production. Note the API base here is the
 * same-origin `/api/v1` — no dev server, no proxy shim.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:8090'
const API = process.env.API_URL ?? `${APP}/api/v1`
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\//, '')
mkdirSync(OUT, { recursive: true })

const problems = []

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@flowboard.app', password: 'demo1234' }),
})
if (!login.ok) throw new Error(`demo login failed: ${login.status} ${await login.text()}`)
const session = await login.json()
console.log(`signed in through nginx as ${session.user.email}`)

const boardsResponse = await fetch(`${API}/boards`, {
  headers: { Authorization: `Bearer ${session.accessToken}` },
})
const { boards } = await boardsResponse.json()
const board = boards.find((candidate) => candidate.title === 'Product launch') ?? boards[0]
console.log(`board: ${board.title}`)

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
})
await context.addInitScript(
  ([token, refresh, user]) => {
    window.localStorage.setItem(
      'flowboard.auth',
      JSON.stringify({
        state: { user: JSON.parse(user), accessToken: token, refreshToken: refresh },
        version: 0,
      }),
    )
  },
  [session.accessToken, session.refreshToken, JSON.stringify(session.user)],
)

const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText ?? ''
  if (reason.includes('ERR_ABORTED')) return
  problems.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
})

// 1. The built bundle boots from nginx.
await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 20_000 })
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/docker-dashboard.png` })
console.log('dashboard rendered from the container image')

// 2. A board renders and its cards are interactive.
await page.goto(`${APP}/boards/${board.id}`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: board.title }).waitFor({ timeout: 20_000 })
await page.waitForTimeout(900)
const cards = await page.locator('article[aria-label]').count()
console.log(`board rendered ${cards} cards`)
if (cards === 0) problems.push('board rendered no cards from the container image')
await page.screenshot({ path: `${OUT}/docker-board.png` })

// 3. Create a card the way a user would, then confirm the API persisted it.
const todoColumn = page.locator('section[aria-label="To do column"]')
await todoColumn.getByRole('button', { name: /Add a card to To do/ }).click()
const composer = page.getByRole('textbox', { name: /New card title for To do/ })
await composer.waitFor({ timeout: 10_000 })
const title = `Verified in the container image ${Date.now() % 100000}`
await composer.fill(title)
await composer.press('Enter')
await page.waitForTimeout(1800)

const snapshot = await (
  await fetch(`${API}/boards/${board.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
).json()
const persisted = snapshot.cards.find((card) => card.title === title)
if (!persisted) problems.push(`the card "${title}" was not persisted via the containerised API`)
else console.log(`created "${title}" through the UI; API confirms it exists`)
await page.screenshot({ path: `${OUT}/docker-composer.png` })

// 4. Realtime status must report the SSE stream as live through nginx.
const live = await page.locator('text=Live').first().isVisible()
console.log(`realtime indicator visible: ${live}`)
if (!live) problems.push('the realtime indicator never reported "Live" through nginx')

await browser.close()

console.log('\n──────── container image summary ────────')
if (problems.length === 0) {
  console.log('no console errors, page errors or failed requests')
} else {
  console.log(`${problems.length} problem(s):`)
  for (const problem of [...new Set(problems)]) console.log(` - ${problem}`)
}
process.exitCode = problems.length === 0 ? 0 : 1
