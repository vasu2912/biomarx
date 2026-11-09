import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const ROUTES = (process.argv[2] ?? '/,/sleep,/rhythm,/heart,/patterns,/mobility,/ecg,/import').split(',')
const OUT = new URL('./screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
let failed = 0

for (const route of ROUTES) {
  const errors = []
  const onConsole = (m) => m.type() === 'error' && errors.push(m.text())
  const onError = (e) => errors.push(String(e))
  page.on('console', onConsole)
  page.on('pageerror', onError)
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForLoadState('networkidle')
  const marks = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body
    const drawn = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 4 && r.height > 4
    }
    const paths = [...main.querySelectorAll('svg path, svg rect, svg circle')].filter(drawn).length
    const canvases = [...main.querySelectorAll('canvas')].filter(drawn).length
    const figures = main.querySelectorAll('figure').length
    return { paths, canvases, figures, text: main.innerText.slice(0, 80).replace(/\s+/g, ' ') }
  })
  const name = route === '/' ? 'overview' : route.slice(1).replaceAll('/', '_')
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true })
  page.off('console', onConsole)
  page.off('pageerror', onError)
  const ok = errors.length === 0 && marks.paths + marks.canvases > 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${route.padEnd(10)} figures=${marks.figures} marks=${marks.paths} canvases=${marks.canvases} errors=${errors.length}`)
  for (const e of errors.slice(0, 5)) console.log(`     ${e.slice(0, 300)}`)
}

await browser.close()
console.log(`screenshots: ${OUT}`)
process.exit(failed ? 1 : 0)
