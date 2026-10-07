import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NotificationBell } from '@/components/NotificationBell'
import { api } from '@/lib/api'
import type { AppNotification } from '@/lib/types'

vi.mock('@/lib/api', () => ({
  api: {
    list: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}))

const mockedList = vi.mocked(api.list)
const mockedMarkRead = vi.mocked(api.markRead)
const mockedMarkAllRead = vi.mocked(api.markAllRead)

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n-1',
    titulo: 'Nova atividade',
    mensagem: 'O Professor Ana adicionou você na atividade Torneio.',
    lida: false,
    link: null,
    criado_em: '2026-10-07T12:00:00+00:00',
    ...overrides,
  }
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedList.mockResolvedValue({ notifications: [], unread: 0 })
  })

  it('não mostra o badge quando não há não lidas', async () => {
    mockedList.mockResolvedValue({ notifications: [makeNotification({ lida: true })], unread: 0 })
    render(<NotificationBell />)
    await waitFor(() => expect(mockedList).toHaveBeenCalled())
    expect(screen.queryByTestId('notif-badge')).toBeNull()
  })

  it('mostra o badge com a contagem de não lidas', async () => {
    mockedList.mockResolvedValue({
      notifications: [makeNotification(), makeNotification({ id: 'n-2', titulo: 'Novo treino' }), makeNotification({ id: 'n-3' })],
      unread: 3,
    })
    render(<NotificationBell />)
    await waitFor(() => expect(screen.getByTestId('notif-badge')).toHaveTextContent('3'))
  })

  it('mostra 9+ quando há mais de nove não lidas', async () => {
    const many = Array.from({ length: 12 }, (_, i) => makeNotification({ id: `n-${i}` }))
    mockedList.mockResolvedValue({ notifications: many, unread: 12 })
    render(<NotificationBell />)
    await waitFor(() => expect(screen.getByTestId('notif-badge')).toHaveTextContent('9+'))
  })

  it('abre o dropdown ao clicar no sino e lista as notificações', async () => {
    mockedList.mockResolvedValue({ notifications: [makeNotification()], unread: 1 })
    render(<NotificationBell />)
    await waitFor(() => expect(mockedList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /notificações/i }))
    expect(screen.getByRole('dialog', { name: 'Notificações' })).toBeInTheDocument()
    expect(screen.getByText('Nova atividade')).toBeInTheDocument()
    expect(screen.getByText(/O Professor Ana adicionou você/i)).toBeInTheDocument()
  })

  it('marca uma notificação como lida (otimista) e zera o badge', async () => {
    mockedMarkRead.mockResolvedValue({ id: 'n-1', lida: true })
    mockedList.mockResolvedValue({ notifications: [makeNotification()], unread: 1 })
    render(<NotificationBell />)
    await waitFor(() => expect(mockedList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /notificações/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como lida' }))

    await waitFor(() => expect(mockedMarkRead).toHaveBeenCalledWith('n-1'))
    // Badge some (unread passou a 0 de forma otimista).
    await waitFor(() => expect(screen.queryByTestId('notif-badge')).toBeNull())
    // A notificação continua listada, agora com estilo de lida.
    expect(screen.getByText('Nova atividade')).toBeInTheDocument()
  })

  it('marca todas como lidas de uma vez', async () => {
    mockedMarkAllRead.mockResolvedValue({ modified: 2 })
    mockedList.mockResolvedValue({
      notifications: [makeNotification(), makeNotification({ id: 'n-2' })],
      unread: 2,
    })
    render(<NotificationBell />)
    await waitFor(() => expect(mockedList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /notificações/i }))
    fireEvent.click(screen.getByRole('button', { name: /marcar todas como lidas/i }))

    await waitFor(() => expect(mockedMarkAllRead).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('notif-badge')).toBeNull())
  })

  it('faz rollback (refetch) quando markRead falha', async () => {
    mockedMarkRead.mockRejectedValue(new Error('offline'))
    mockedList.mockResolvedValue({ notifications: [makeNotification()], unread: 1 })
    render(<NotificationBell />)
    await waitFor(() => expect(mockedList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /notificações/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como lida' }))

    // O hook refetcha a lista quando o POST falha — a notificação volta não lida.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('notif-badge')).toHaveTextContent('1'))
  })

  it('mostra estado vazio quando não há notificações', async () => {
    mockedList.mockResolvedValue({ notifications: [], unread: 0 })
    render(<NotificationBell />)
    await waitFor(() => expect(mockedList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }))
    expect(screen.getByText('Nada por aqui ainda.')).toBeInTheDocument()
  })
})
