import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSession } from '@/hooks/useSession'
import { useStudentPortal } from '@/hooks/useStudentPortal'

vi.mock('@/lib/api', () => ({
  api: {
    session: vi.fn(),
    portal: vi.fn(),
    setRankingPreference: vi.fn(),
    login: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

import { api } from '@/lib/api'

// Node 22+ exposes an experimental global localStorage that shadows jsdom's and
// has no methods without --localstorage-file. An in-memory Storage keeps the
// session-hint tests independent of the Node version.
const memory = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, String(value)) },
    removeItem: (key: string) => { memory.delete(key) },
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size },
  } satisfies Storage,
})

describe('Hook Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // useSession keeps a "probably signed in" hint between page loads.
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('useSession', () => {
    it('should initialize with loading status when session cookie exists', () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'gesp_session=abc123; path=/',
      })

      const { result } = renderHook(() => useSession())

      expect(result.current.status).toBe('loading')
      expect(result.current.user).toBeNull()
    })

    it('should initialize as anonymous when no session cookie', () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: '',
      })

      const { result } = renderHook(() => useSession())

      expect(result.current.status).toBe('anonymous')
      expect(result.current.user).toBeNull()
    })

    it('starts as loading when a previous sign-in left the hint (HttpOnly cookie is invisible)', async () => {
      Object.defineProperty(document, 'cookie', { writable: true, value: '' })
      window.localStorage.setItem('ge:session-hint', '1')
      vi.mocked(api.session).mockRejectedValueOnce(Object.assign(new Error('Sessão expirada'), { status: 401 }))

      const { result } = renderHook(() => useSession())

      expect(result.current.status).toBe('loading')
      // The server says the session is gone: the hint is cleared for the next load.
      await waitFor(() => expect(result.current.status).toBe('anonymous'))
      expect(window.localStorage.getItem('ge:session-hint')).toBeNull()
    })

    it('should update status to authenticated on successful login', async () => {
      const mockUser = { id: '1', nome: 'Test', email: 'test@test.com', tipo: 'aluno' as const, status: 'ativo' as const, aluno_id: null, filhos_ids: [], is_root_admin: false }
      vi.mocked(api.login).mockResolvedValue({ user: mockUser })

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.login('test@test.com', 'password')
      })

      expect(result.current.status).toBe('authenticated')
      expect(result.current.user).toEqual(mockUser)
    })

    it('should handle login error', async () => {
      vi.mocked(api.login).mockRejectedValue(new Error('Invalid credentials'))

      const { result } = renderHook(() => useSession())

      await act(async () => {
        try {
          await result.current.login('test@test.com', 'wrong')
        } catch (e) {
          // Expected
        }
      })

      expect(result.current.status).toBe('anonymous')
      expect(result.current.error).toBe('Invalid credentials')
    })

    it('should call refreshSession and update status', async () => {
      const mockUser = { id: '1', nome: 'Test', email: 'test@test.com', tipo: 'aluno' as const, status: 'ativo' as const, aluno_id: null, filhos_ids: [], is_root_admin: false }
      vi.mocked(api.session).mockResolvedValue({ user: mockUser })

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.refreshSession()
      })

      expect(api.session).toHaveBeenCalled()
      expect(result.current.status).toBe('authenticated')
      expect(result.current.user).toEqual(mockUser)
    })

    it('should handle 401 on refreshSession', async () => {
      const apiError = new Error('Unauthorized')
      ;(apiError as any).status = 401
      vi.mocked(api.session).mockRejectedValue(apiError)

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.refreshSession()
      })

      expect(result.current.status).toBe('anonymous')
      expect(result.current.user).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })

  describe('useStudentPortal', () => {
    const mockSnapshot = {
      aluno: { id: 'child-1', nome: 'Maria', turma_id: 'turma-1', participa_ranking: true, consentimentoRankingAtualizadoEm: '2024-01-01' },
      turma: { id: 'turma-1', nome: 'Turma A', modalidade: 'Futebol', ano: 2024 },
      professor_nome: 'Prof. João',
      presencas: [],
      avaliacoes: [],
      conquistas: [],
      ocorrencias: [],
      justificativas: [],
      comunicados: [],
      atualizado_em: '2024-01-01',
    }

    it('should load portal data on mount', async () => {
      vi.mocked(api.portal).mockResolvedValue(mockSnapshot)

      const { result } = renderHook(() => useStudentPortal('child-1'))

      expect(result.current.loading).toBe(true)

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.snapshot).toEqual(mockSnapshot)
      expect(result.current.error).toBeNull()
    })

    it('should keep stale snapshot during refresh (stale-while-revalidate)', async () => {
      vi.mocked(api.portal).mockResolvedValue(mockSnapshot)

      const { result } = renderHook(() => useStudentPortal('child-1'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Trigger refresh
      vi.mocked(api.portal).mockResolvedValue({
        ...mockSnapshot,
        aluno: { ...mockSnapshot.aluno, nome: 'Maria Atualizada' },
      })

      // `refresh()` returns the in-flight request, so the new data is applied
      // once that promise settles. It must be awaited inside `act` so React
      // flushes the state update before we assert.
      await act(async () => {
        await result.current.refresh()
      })

      // During refresh, snapshot keeps the old value (stale-while-revalidate).
      expect(api.portal).toHaveBeenCalledTimes(2)

      // After refresh, should have new data
      expect(result.current.snapshot?.aluno.nome).toBe('Maria Atualizada')
    })

    it('should handle portal load error', async () => {
      vi.mocked(api.portal).mockRejectedValue(new Error('Failed to load'))

      const { result } = renderHook(() => useStudentPortal('child-1'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBe('Failed to load')
      expect(result.current.snapshot).toBeNull()
    })

    it('should update ranking preference optimistically', async () => {
      vi.mocked(api.portal).mockResolvedValue(mockSnapshot)
      vi.mocked(api.setRankingPreference).mockResolvedValue({
        participa_ranking: false,
        atualizado_em: '2024-01-02',
      })

      const { result } = renderHook(() => useStudentPortal('child-1'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.snapshot?.aluno.participa_ranking).toBe(true)

      await act(async () => {
        await result.current.setRankingPreference(false)
      })

      // Optimistic update
      expect(result.current.snapshot?.aluno.participa_ranking).toBe(false)
      expect(api.setRankingPreference).toHaveBeenCalledWith(false)
    })

    it('should rollback on ranking preference error', async () => {
      vi.mocked(api.portal).mockResolvedValue(mockSnapshot)
      vi.mocked(api.setRankingPreference).mockRejectedValue(new Error('Failed'))

      const { result } = renderHook(() => useStudentPortal('child-1'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        try {
          await result.current.setRankingPreference(false)
        } catch (e) {
          // Expected
        }
      })

      // Should rollback to original value
      expect(result.current.snapshot?.aluno.participa_ranking).toBe(true)
    })

    it('should refetch when alunoId changes', async () => {
      vi.mocked(api.portal).mockResolvedValue(mockSnapshot)

      const { result, rerender } = renderHook(
        ({ alunoId }) => useStudentPortal(alunoId),
        { initialProps: { alunoId: 'child-1' } }
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(api.portal).toHaveBeenCalledWith('child-1')

      // Change alunoId
      rerender({ alunoId: 'child-2' })

      expect(api.portal).toHaveBeenCalledWith('child-2')
    })
  })
})
