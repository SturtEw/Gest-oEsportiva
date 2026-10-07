import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiModules } from './api'
import { resetGoogleConfigCache } from './api/auth'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('api object', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('has no method name shared by two domain modules', () => {
    const owners = new Map<string, string[]>()
    for (const [moduleName, module] of Object.entries(apiModules)) {
      for (const key of Object.keys(module)) owners.set(key, [...(owners.get(key) ?? []), moduleName])
    }
    const collisions = [...owners].filter(([, modules]) => modules.length > 1).map(([key, modules]) => `${key}: ${modules.join(', ')}`)
    expect(collisions).toEqual([])
  })

  it('loads student questions from the student route, not the professor route', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await api.questions('aluno-1')
    await api.teacherQuestions('aluno-1')

    const paths = fetchMock.mock.calls.map(([url]) => String(url))
    expect(paths[0]).toMatch(/\/api\/student\/aluno-1\/questions$/)
    expect(paths[1]).toMatch(/\/api\/professor\/students\/aluno-1\/questions$/)
  })

  it('sends DELETE to the class endpoint when deleting a class', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: 'c-1', nome: 'Futsal', status: 'excluida', students_unlinked: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await api.deleteClass('c-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/admin\/classes\/c-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
    expect(result.status).toBe('excluida')
  })

  it('requests google-config once per page and retries after a failure', async () => {
    resetGoogleConfigCache()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ client_id: 'abc', csrf_token: 'raw.sig' }))
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([api.googleConfig(), api.googleConfig()])
    await api.googleConfig()

    expect(first.client_id).toBe('abc')
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resetGoogleConfigCache()
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(api.googleConfig()).rejects.toThrow()
    await api.googleConfig()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps the admin student search on api.students', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ students: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await api.students('ana')

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/admin\/students\?unassigned=true&q=ana$/)
  })
})
