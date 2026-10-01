import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ImpersonationProvider, useImpersonation } from './useImpersonation'
import { request } from '@/lib/api/client'

afterEach(() => vi.unstubAllGlobals())

describe('View As', () => {
  it('rejects a non-root account even when setViewAs is called directly', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ImpersonationProvider userId="teacher" userRole="professor" userIsRootAdmin={false}>{children}</ImpersonationProvider>
    const { result } = renderHook(useImpersonation, { wrapper })
    act(() => result.current.setViewAs('aluno', { id: 'student-user', nome: 'Aluno', aluno_id: 'student' }))
    expect(result.current.impersonatedRole).toBeNull()
  })

  it('keeps the original role, sends the target on reads, blocks writes and clears the view', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = ({ children }: { children: ReactNode }) => <ImpersonationProvider userId="root" userRole="admin" userIsRootAdmin>{children}</ImpersonationProvider>
    const { result } = renderHook(useImpersonation, { wrapper })
    act(() => result.current.setViewAs('aluno', { id: 'student-user', nome: 'Aluno', aluno_id: 'student' }))
  expect(result.current.originalRole).toBe('admin')
  expect(result.current.effectiveRole).toBe('aluno')
  expect(result.current.effectiveIsRootAdmin).toBe(false)
  await request('/api/student/portal')
  const headers = fetchMock.mock.calls[0][1].headers as Headers
  expect(headers.get('X-Impersonate-Role')).toBe('aluno')
  expect(headers.get('X-Impersonate-Target')).toBe('student-user')
  await expect(request('/api/student/me/ranking-preference', { method: 'PATCH' })).rejects.toMatchObject({ status: 403 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  act(() => result.current.clearImpersonation())
  expect(result.current.effectiveRole).toBe('admin')
  await request('/api/admin/summary')
  expect((fetchMock.mock.calls[1][1].headers as Headers).has('X-Impersonate-Role')).toBe(false)
})
})
