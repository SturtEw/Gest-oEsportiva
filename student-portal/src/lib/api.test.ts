import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiModules } from './api'

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

  it('keeps the admin student search on api.students', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ students: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await api.students('ana')

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/admin\/students\?unassigned=true&q=ana$/)
  })
})
