#!/usr/bin/env node
/**
 * Migra o projeto para domínio próprio (Safari mantém a sessão).
 *
 *   node scripts/custom-domain.mjs apply [dominio] [--dry-run] [--root <dir>]
 *
 * O domínio fica em UM lugar: o argumento acima (ou DEFAULT_DOMAIN). O script
 * deriva os hosts e reescreve todos os arquivos que dependem deles:
 *
 *   site → https://app.<dominio>      (Firebase Hosting, domínio personalizado)
 *   API  → https://api.<dominio>      (Render, custom domain)
 *
 * Front e API passam a ser o MESMO site, então o cookie de sessão deixa de ser
 * de terceiros: SESSION_SAMESITE vai de none para lax.
 *
 * Só rode DEPOIS que app.<dominio> e api.<dominio> estiverem verificados e com
 * HTTPS (passo a passo em docs/custom-domain.md). Idempotente: rodar de novo
 * com outro domínio troca os valores.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Placeholder até o domínio ser registrado. Troque aqui ou passe na linha de comando.
const DEFAULT_DOMAIN = 'gestaoesportiva.com.br'

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { command, domain: DEFAULT_DOMAIN, dryRun: false, root: resolve(dirname(fileURLToPath(import.meta.url)), '..') }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--root') opts.root = resolve(rest[++i] ?? '')
    else if (!arg.startsWith('--')) opts.domain = arg.trim().toLowerCase().replace(/\.$/, '')
    else throw new Error(`Opção desconhecida: ${arg}`)
  }
  return opts
}

/** Replace exactly one match; fail loudly instead of silently leaving a file stale. */
function replaceOne(content, pattern, replacement, label) {
  const matches = content.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: esperava 1 ocorrência, encontrei ${matches ? matches.length : 0}`)
  }
  return content.replace(pattern, replacement)
}

function buildEdits({ appOrigin, apiHost, apiOrigin }) {
  const connectSrc = (content, label) =>
    replaceOne(content, /(connect-src 'self' )https:\/\/[^\s;"]+ wss:\/\/[^\s;"]+/, `$1${apiOrigin} wss://${apiHost}`, label)

  return [
    {
      file: 'render.yaml',
      apply(content) {
        let next = replaceOne(content, /(- key: SESSION_SAMESITE\r?\n\s+value: )\S+/, '$1lax', 'render.yaml SESSION_SAMESITE')
        next = replaceOne(next, /(- key: FRONTEND_ORIGINS\r?\n\s+value: )\S+/, `$1${appOrigin}`, 'render.yaml FRONTEND_ORIGINS')
        next = replaceOne(next, /(- key: FRONTEND_URL\r?\n\s+value: )\S+/, `$1${appOrigin}`, 'render.yaml FRONTEND_URL')
        if (/^\s+domains:\s*$/m.test(next)) {
          next = replaceOne(next, /(\n\s+domains:\r?\n\s+- )\S+/, `$1${apiHost}`, 'render.yaml domains')
        } else {
          next = replaceOne(next, /(\n([ \t]+)healthCheckPath: \S+)(\r?\n)/, `$1$3$2domains:$3$2  - ${apiHost}$3`, 'render.yaml healthCheckPath')
        }
        return next
      },
    },
    { file: 'firebase.json', apply: c => connectSrc(c, 'firebase.json connect-src') },
    { file: 'student-portal/firebase.json', apply: c => connectSrc(c, 'student-portal/firebase.json connect-src') },
    {
      file: 'student-portal/.env.production',
      apply(content) {
        let next = replaceOne(content, /^VITE_API_BASE=.*$/m, `VITE_API_BASE=${apiOrigin}`, '.env.production VITE_API_BASE')
        next = replaceOne(next, /^VITE_CANONICAL_ORIGIN=.*$/m, `VITE_CANONICAL_ORIGIN=${appOrigin}`, '.env.production VITE_CANONICAL_ORIGIN')
        return next
      },
    },
    {
      file: 'backend/scripts/smoke_render_config.py',
      apply(content) {
        let next = replaceOne(content, /^FRONTEND_ORIGIN = ".*"$/m, `FRONTEND_ORIGIN = "${appOrigin}"`, 'smoke FRONTEND_ORIGIN')
        next = replaceOne(next, /^EXTRA_FRONTEND_ORIGINS = \[.*\]$/m, 'EXTRA_FRONTEND_ORIGINS = []', 'smoke EXTRA_FRONTEND_ORIGINS')
        next = replaceOne(next, /^EXPECTED_SAMESITE = ".*"$/m, 'EXPECTED_SAMESITE = "lax"', 'smoke EXPECTED_SAMESITE')
        return next
      },
    },
  ]
}

function printChecklist({ appOrigin, apiOrigin, appHost }) {
  console.log(`
Próximos passos (detalhes em docs/custom-domain.md):
  1. Conferir:  cd backend && python scripts/smoke_render_config.py
  2. GitHub → Settings → Secrets and variables → Actions → Variables:
       VITE_API_BASE = ${apiOrigin}
  3. Se o serviço do Render NÃO foi criado por Blueprint, ajuste no painel:
       SESSION_SAMESITE=lax  FRONTEND_ORIGINS=${appOrigin}  FRONTEND_URL=${appOrigin}
  4. Google Cloud Console → Credentials → OAuth client → Authorized JavaScript origins:
       ${appOrigin}
  5. Commit + push (Render redeploya) e, logo em seguida, publique o front:
       cd student-portal && npm run build && cd .. && firebase deploy --only hosting
  6. Testar no Safari: login em https://${appHost}, recarregar, salvar algo.`)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.command !== 'apply') {
    console.log('Uso: node scripts/custom-domain.mjs apply [dominio] [--dry-run] [--root <dir>]')
    process.exit(opts.command ? 1 : 0)
  }
  if (!DOMAIN_RE.test(opts.domain) || /^(app|api|www)\./.test(opts.domain)) {
    throw new Error(`Domínio inválido: "${opts.domain}". Informe o domínio raiz, ex.: gestaoesportiva.com.br`)
  }

  const hosts = { appHost: `app.${opts.domain}`, apiHost: `api.${opts.domain}` }
  hosts.appOrigin = `https://${hosts.appHost}`
  hosts.apiOrigin = `https://${hosts.apiHost}`

  // Calcula tudo antes de gravar: se um padrão não bater, nenhum arquivo muda.
  const results = buildEdits(hosts).map(edit => {
    const path = join(opts.root, edit.file)
    const before = readFileSync(path, 'utf8')
    return { ...edit, path, before, after: edit.apply(before) }
  })

  console.log(`Domínio: ${opts.domain}  →  site ${hosts.appOrigin}  |  API ${hosts.apiOrigin}${opts.dryRun ? '  (dry-run)' : ''}\n`)
  for (const r of results) {
    const changed = r.before !== r.after
    console.log(`${changed ? (opts.dryRun ? 'mudaria ' : 'alterado') : 'igual   '}  ${r.file}`)
    if (changed && !opts.dryRun) writeFileSync(r.path, r.after, 'utf8')
  }
  printChecklist(hosts)
}

try {
  main()
} catch (error) {
  console.error(`\nERRO: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
