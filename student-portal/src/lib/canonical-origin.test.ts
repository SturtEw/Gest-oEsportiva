import { describe, expect, it } from 'vitest'
import { canonicalRedirectTarget } from './canonical-origin'

function at(href: string) {
  const url = new URL(href)
  return { origin: url.origin, hostname: url.hostname, pathname: url.pathname, search: url.search, hash: url.hash }
}

const CANONICAL = 'https://app.gestaoesportiva.com.br'

describe('canonicalRedirectTarget', () => {
  it('does nothing while no custom domain is configured', () => {
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa.web.app/'), undefined)).toBeNull()
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa.web.app/'), '  ')).toBeNull()
  })

  it('sends Firebase default hosts to the same path on the canonical origin', () => {
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa.web.app/reset-senha?token=abc#x'), CANONICAL))
      .toBe('https://app.gestaoesportiva.com.br/reset-senha?token=abc#x')
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa.firebaseapp.com/'), CANONICAL))
      .toBe('https://app.gestaoesportiva.com.br/')
  })

  it('never loops on the canonical origin itself', () => {
    expect(canonicalRedirectTarget(at('https://app.gestaoesportiva.com.br/painel'), CANONICAL)).toBeNull()
  })

  it('leaves preview channels, localhost and other hosts alone', () => {
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa--pr12-abc123.web.app/'), CANONICAL)).toBeNull()
    expect(canonicalRedirectTarget(at('http://localhost:5173/'), CANONICAL)).toBeNull()
    expect(canonicalRedirectTarget(at('https://example.com/'), CANONICAL)).toBeNull()
  })

  it('ignores invalid or non-https canonical values', () => {
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa.web.app/'), 'not a url')).toBeNull()
    expect(canonicalRedirectTarget(at('https://gestaoesportiva-9d8fa.web.app/'), 'http://app.gestaoesportiva.com.br')).toBeNull()
  })
})
