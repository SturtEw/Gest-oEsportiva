// Bundle size report and budget (docs/code-splitting-plan.md, steps 0 and 7).
//
//   node scripts/bundle-size.mjs           report only
//   node scripts/bundle-size.mjs --check   report + exit 1 when a budget is exceeded
//
// "Initial" = what dist/index.html loads before any lazy import: the entry
// script, its modulepreload links and the stylesheets. Everything else is a
// lazy chunk, downloaded only when a screen or section needs it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const assetsDir = path.join(dist, 'assets')

/**
 * gzip kB budgets. initialCss is 36, not the plan's 25: the initial stylesheet
 * is Tailwind's single sheet with every utility the app uses (~32 kB gz) plus
 * the font-faces (~2 kB gz); the Tailwind Vite plugin cannot split it per route.
 */
const BUDGET = {
  initialJs: 90,
  initialCss: 36,
  lazyChunk: 120,
}

const kb = (bytes) => bytes / 1024
const fmt = (bytes) => `${kb(bytes).toFixed(1).padStart(7)} kB`

function measure(file) {
  const content = readFileSync(path.join(dist, file))
  return { file, raw: content.length, gzip: gzipSync(content, { level: 9 }).length }
}

let html
try {
  html = readFileSync(path.join(dist, 'index.html'), 'utf8')
} catch {
  console.error('dist/index.html not found. Run `npm run build` first.')
  process.exit(1)
}

const initialFiles = new Set(
  [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]),
)
const all = readdirSync(assetsDir)
  .filter((name) => /\.(js|css)$/.test(name) && statSync(path.join(assetsDir, name)).isFile())
  .map((name) => measure(`assets/${name}`))
  .sort((a, b) => b.gzip - a.gzip)

const initial = all.filter((item) => initialFiles.has(item.file))
const lazy = all.filter((item) => !initialFiles.has(item.file))
const sum = (items, ext) => items.filter((item) => item.file.endsWith(ext)).reduce((total, item) => total + item.gzip, 0)

const row = (item) => `${fmt(item.raw)}  ${fmt(item.gzip)} gz  ${item.file}`
console.log('Initial (loaded by index.html):')
initial.forEach((item) => console.log(`  ${row(item)}`))
console.log(`  = JS ${kb(sum(initial, '.js')).toFixed(1)} kB gz · CSS ${kb(sum(initial, '.css')).toFixed(1)} kB gz\n`)
console.log('Lazy chunks:')
lazy.forEach((item) => console.log(`  ${row(item)}`))

if (process.argv.includes('--check')) {
  const failures = []
  if (kb(sum(initial, '.js')) > BUDGET.initialJs) failures.push(`initial JS ${kb(sum(initial, '.js')).toFixed(1)} kB gz > ${BUDGET.initialJs} kB`)
  if (kb(sum(initial, '.css')) > BUDGET.initialCss) failures.push(`initial CSS ${kb(sum(initial, '.css')).toFixed(1)} kB gz > ${BUDGET.initialCss} kB`)
  for (const item of lazy) {
    if (kb(item.gzip) > BUDGET.lazyChunk) failures.push(`${item.file} ${kb(item.gzip).toFixed(1)} kB gz > ${BUDGET.lazyChunk} kB`)
  }
  if (failures.length) {
    console.error(`\nBundle budget exceeded:\n  - ${failures.join('\n  - ')}`)
    process.exit(1)
  }
  console.log('\nBundle budget OK.')
}
