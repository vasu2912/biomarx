import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

/** Each shot is a route plus either the viewport or one element; `hover` moves the pointer to a fraction of that element. */
const SHOTS = [
  { name: 'overview', route: '/', viewport: true },
  { name: 'sleep-actogram', route: '/sleep', figure: '2.1' },
  { name: 'sleep-timing', route: '/sleep', figure: '2.2', hover: [0.62, 0.55] },
  { name: 'sleep-architecture', route: '/sleep', figure: '2.5' },
  { name: 'rhythm-actogram', route: '/rhythm', figure: '3.1' },
  { name: 'rhythm-periodogram', route: '/rhythm', figure: '3.5' },
  { name: 'heart-dose-response', route: '/heart', figure: '4.5' },
  { name: 'heart-ridgeline', route: '/heart', figure: '4.6' },
  { name: 'patterns', route: '/patterns', figure: '5.1', parent: true },
  { name: 'ecg', route: '/ecg', figure: '7.2' },
  { name: 'mobility-week', route: '/mobility', figure: '6.3' },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
let current = ''
const PAD = 28

for (const s of SHOTS) {
  if (s.route !== current) {
    await page.goto(BASE + s.route, { waitUntil: 'networkidle' })
    current = s.route
  }
  const path = `${OUT}${s.name}.png`
  if (s.viewport) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(600)
    await page.screenshot({ path, clip: { x: 0, y: 0, width: 1440, height: 900 } })
  } else {
    await page.addStyleTag({ content: 'header.sticky { position: static !important; }' })
    let el = page.locator(`[data-figure="${s.figure}"]`)
    if (s.parent) el = el.locator('..')
    await el.scrollIntoViewIfNeeded()
    const top = (await el.boundingBox()).y
    await page.evaluate((dy) => window.scrollBy(0, dy), top - 40)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(700)
    if (s.hover) {
      const box = await el.boundingBox()
      await page.mouse.move(box.x + box.width * s.hover[0], box.y + box.height * s.hover[1])
      await page.waitForTimeout(250)
    }
    const b = await el.boundingBox()
    await page.screenshot({ path, animations: 'disabled', clip: { x: b.x - PAD, y: b.y - PAD, width: b.width + 2 * PAD, height: b.height + 2 * PAD } })
    await page.mouse.move(0, 0)
  }
  console.log(`wrote ${path}`)
}

await browser.close()
