/**
 * FlowBoard UI verification harness.
 *
 * Drives the real app in Chrome (via playwright-core, no browser download) and
 * captures screenshots plus any console/page errors. Run with:
 *   node verify.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:8080/api/v1'
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\//, '')

mkdirSync(OUT, { recursive: true })

const problems = []
const step = (name) => console.log(`\n▶ ${name}`)

async function main() {
  // 1. A real session, obtained through the public API.
  step('signing in through the API')
  const loginResponse = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@flowboard.app', password: 'demo1234' }),
  })
  if (!loginResponse.ok) throw new Error(`login failed: ${loginResponse.status}`)
  const session = await loginResponse.json()
  console.log(`   session for ${session.user.email}`)

  const boardsResponse = await fetch(`${API}/boards`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
  const { boards } = await boardsResponse.json()
  const board = boards.find((candidate) => candidate.title === 'Product launch') ?? boards[0]
  console.log(`   board: ${board.title} (${board.id})`)

  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  })

  // Seed the persisted session before any app code runs.
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
    if (message.type() === 'warning' && /react|hook/i.test(message.text())) {
      problems.push(`console.warn: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    // In-flight fetches are cancelled whenever the SPA navigates; that is
    // normal behaviour, not a failure.
    if (reason.includes('ERR_ABORTED')) return
    problems.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
    console.log(`   captured ${name}.png`)
  }

  // 2. Dashboard
  step('dashboard')
  await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(600)
  await shot('01-dashboard-dark')

  // 3. Board
  step('board')
  await page.goto(`${APP}/boards/${board.id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: board.title }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(700)
  const cardCount = await page.locator('article[aria-label]').count()
  console.log(`   rendered ${cardCount} cards`)
  const columnCount = await page.locator('section[aria-label$="column"]').count()
  console.log(`   rendered ${columnCount} columns`)
  if (cardCount === 0) problems.push('board rendered no cards')
  await shot('02-board-dark')

  // 4. Light theme
  step('light theme')
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.waitForTimeout(450)
  await shot('03-board-light')
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.waitForTimeout(300)

  // 5. Inline card composer via the `n` shortcut
  step('inline card capture')
  await page.keyboard.press('n')
  await page.waitForTimeout(400)
  const composer = page.getByRole('textbox', { name: /New card title for/ })
  await composer.waitFor({ timeout: 5_000 })
  await composer.fill('Verify the release checklist')
  await shot('04-composer')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // 6. Card drawer
  step('card drawer')
  const firstCard = page.locator('article[aria-label]').first()
  const firstCardTitle = await firstCard.getAttribute('aria-label')
  await firstCard.click()
  await page.getByRole('dialog', { name: 'Card details' }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(900)
  console.log(`   opened: ${firstCardTitle}`)
  await shot('05-card-drawer')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 7. Command palette
  step('command palette')
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ timeout: 5_000 })
  await page.getByRole('textbox', { name: 'Command palette' }).fill('launch')
  await page.waitForTimeout(600)
  await shot('06-command-palette')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 8. Drag a card between columns
  step('drag and drop')
  const sourceCard = page.locator('article[aria-label]').first()
  const sourceTitle = await sourceCard.getAttribute('aria-label')
  const targetColumn = page.locator('section[aria-label$="column"]').nth(2)
  const sourceBox = await sourceCard.boundingBox()
  const targetBox = await targetColumn.boundingBox()
  if (sourceBox && targetBox) {
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + 20)
    await page.mouse.down()
    // Move in steps so the pointer sensor registers a real drag.
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(
        sourceBox.x + (targetBox.x - sourceBox.x) * (i / 12) + 100,
        sourceBox.y + 20 + (targetBox.y - sourceBox.y) * (i / 12) + 120,
        { steps: 2 },
      )
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(1400)
    await shot('07-after-drag')

    const response = await fetch(`${API}/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const snapshot = await response.json()
    const moved = snapshot.cards.find((card) => card.title === sourceTitle)
    const originalColumn = snapshot.columns.find((column) => column.title === 'To do')
    console.log(`   "${sourceTitle}" is now in column ${moved?.columnId}`)
    if (moved && originalColumn && moved.columnId === originalColumn.id) {
      problems.push(`drag did not persist: "${sourceTitle}" is still in To do`)
    }
  } else {
    problems.push('could not measure the drag geometry')
  }

  // 9. Search page
  step('search')
  await page.goto(`${APP}/search`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'Search all cards' }).fill('docker')
  await page.waitForTimeout(900)
  await shot('08-search')

  // 10. My work
  step('my work')
  await page.goto(`${APP}/my-work`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await shot('09-my-work')

  // 11. Boards gallery
  step('boards gallery')
  await page.goto(`${APP}/boards`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await shot('10-boards')

  // 12. Settings
  step('settings')
  await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await shot('11-settings')

  // 13. Sign-in screen (fresh context, no session)
  step('sign-in screen')
  const anonymous = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  })
  const anonymousPage = await anonymous.newPage()
  await anonymousPage.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
  await anonymousPage.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 10_000 })
  await anonymousPage.waitForTimeout(400)
  await anonymousPage.screenshot({ path: `${OUT}/12-signin.png` })
  console.log('   captured 12-signin.png')
  await anonymous.close()

  await browser.close()

  console.log('\n──────── summary ────────')
  if (problems.length === 0) {
    console.log('no console errors, page errors or failed requests')
  } else {
    console.log(`${problems.length} problem(s):`)
    for (const problem of [...new Set(problems)]) console.log(` - ${problem}`)
  }
  process.exitCode = problems.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('\nverification failed:', error)
  process.exitCode = 2
})
