import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression cover for the "Prompt não exibido" dead end.
 *
 * The old code called `accounts.id.prompt()` on click and rejected whenever the browser
 * declined to draw the One Tap UI. One Tap is suppressed in ordinary situations (user
 * already signed in to Google, third-party-iframe context, expired user gesture), so it
 * failed for most people. The fix renders Google's own button with `ux_mode: 'popup'`.
 */

interface FakeApi {
  initialize: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  renderButton: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function fakeGoogle(): FakeApi {
  return {
    initialize: vi.fn(),
    prompt: vi.fn(),
    // renderButton draws into an iframe in production; the stub appends a stand-in node
    // so the tests can assert that destroy() actually empties the container.
    renderButton: vi.fn((parent: HTMLElement) => { parent.appendChild(document.createElement('div')) }),
    cancel: vi.fn(),
  }
}

let api: FakeApi

beforeEach(() => {
  api = fakeGoogle()
  // The module caches the loaded script in a module-level promise, so reset the module
  // between tests to exercise the "load once" path deterministically.
  vi.resetModules()
    ; (window as unknown as { google?: unknown }).google = { accounts: { id: api } }
})

describe('loadGoogleIdentity', () => {
  it('resolves immediately when the GIS namespace is already present', async () => {
    const { loadGoogleIdentity: load } = await import('@/lib/google-identity')
    await expect(load()).resolves.toBe(api)
  })
})

describe('mountGoogleSignInButton', () => {
  it('uses popup mode so a refused One Tap is irrelevant', async () => {
    const { mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    const container = document.createElement('div')

    await mount({ clientId: 'client-123', container, onCredential: () => { } })

    expect(api.initialize).toHaveBeenCalledTimes(1)
    const options = api.initialize.mock.calls[0][0] as { ux_mode: string; client_id: string }
    expect(options.ux_mode).toBe('popup')
    expect(options.client_id).toBe('client-123')
    expect(api.renderButton).toHaveBeenCalledTimes(1)
  })

  it('does not call prompt(), the API that silently refuses to render', async () => {
    const { mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    await mount({ clientId: 'client-123', container: document.createElement('div'), onCredential: () => { } })
    expect(api.prompt).not.toHaveBeenCalled()
  })

  it('delivers the credential exactly once even if Google calls back twice', async () => {
    const { mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    const onCredential = vi.fn()
    await mount({ clientId: 'client-123', container: document.createElement('div'), onCredential })

    const { callback } = api.initialize.mock.calls[0][0] as { callback: (r: { credential: string }) => void }
    callback({ credential: 'token-abc' })
    callback({ credential: 'token-abc' })

    expect(onCredential).toHaveBeenCalledTimes(1)
    expect(onCredential).toHaveBeenCalledWith('token-abc')
  })

  it('reports an error instead of hanging when Google returns an empty credential', async () => {
    const { GoogleAuthError: FreshError, mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    const onError = vi.fn()
    await mount({ clientId: 'client-123', container: document.createElement('div'), onCredential: () => { }, onError })

    const { callback } = api.initialize.mock.calls[0][0] as { callback: (r: { credential: string }) => void }
    callback({ credential: '' })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(FreshError)
  })

  it('surfaces a rendering failure rather than leaving a dead button', async () => {
    const { mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    api.renderButton.mockImplementation(() => { throw new Error('blocked') })

    await expect(mount({ clientId: 'client-123', container: document.createElement('div'), onCredential: () => { } }))
      .rejects.toThrow('blocked')
  })

  it('refuses a missing client id as non-retryable', async () => {
    const { mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    const container = document.createElement('div')

    await expect(mount({ clientId: '', container, onCredential: () => { } })).rejects.toMatchObject({
      retryable: false,
    })
    expect(api.renderButton).not.toHaveBeenCalled()
  })

  it('cleans up the container on destroy so re-mounts do not stack buttons', async () => {
    const { mountGoogleSignInButton: mount } = await import('@/lib/google-identity')
    const container = document.createElement('div')

    const handle = await mount({ clientId: 'client-123', container, onCredential: () => { } })
    expect(container.childElementCount).toBe(1)

    handle.destroy()
    expect(container.childElementCount).toBe(0)
    expect(api.cancel).toHaveBeenCalled()
  })
})

describe('script loading', () => {
  it('rejects with an actionable message when the GIS script cannot load', async () => {
    ; (window as unknown as { google?: unknown }).google = undefined
    const { loadGoogleIdentity: load } = await import('@/lib/google-identity')

    const promise = load()
    const script = document.querySelector('script[data-google-identity="true"]') as HTMLScriptElement
    expect(script.src).toBe('https://accounts.google.com/gsi/client')

    script.onerror?.(new Event('error'))
    await expect(promise).rejects.toThrow(/bloqueadores de popup|Não foi possível carregar/i)
  })
})
