import { chromium } from 'playwright-core'

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
console.log('launching', CHROME)
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
console.log('launched, version:', browser.version())
const page = await browser.newPage()
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded', timeout: 20000 })
console.log('title:', await page.title())
console.log('h2:', await page.locator('h2').first().innerText())
await browser.close()
console.log('done')
