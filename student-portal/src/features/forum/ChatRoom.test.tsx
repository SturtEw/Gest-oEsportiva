import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ChatRoom } from '@/features/forum/ChatRoom'
import { api } from '@/lib/api'
import type { ForumMessage } from '@/lib/types'

vi.mock('@/lib/api', () => ({
  api: {
    messages: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

const mockedMessages = vi.mocked(api.messages)
const mockedSend = vi.mocked(api.sendMessage)

const ME = 'user-me'
const OTHER = 'user-outra'

function makeMessage(overrides: Partial<ForumMessage> = {}): ForumMessage {
  return {
    id: 'm-1',
    autor_id: OTHER,
    autor_nome: 'Ana Souza',
    autor_tipo: 'professor',
    autor_avatar: null,
    texto: 'Bem-vindos à turma!',
    criado_em: '2026-10-07T12:00:00+00:00',
    ...overrides,
  }
}

interface RoomProps {
  turmaId: string | null
  turmaNome: string | null
  totalMembros: number | null
  myUserId: string
  myRole: 'professor' | 'aluno'
  live: boolean
  revision: number
}

function renderRoom(overrides: Partial<RoomProps> = {}) {
  const props: RoomProps = {
    turmaId: 't-1',
    turmaNome: 'Futsal Sub-13',
    totalMembros: 12,
    myUserId: ME,
    myRole: 'aluno',
    live: true,
    revision: 0,
    ...overrides,
  }
  return render(<ChatRoom {...props} />)
}

describe('ChatRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedMessages.mockResolvedValue({ mensagens: [], has_more: false })
    mockedSend.mockResolvedValue(makeMessage())
  })

  it('mostra o estado "escolha uma turma" quando não há turma selecionada', () => {
    renderRoom({ turmaId: null })
    expect(screen.getByText('Escolha uma turma')).toBeInTheDocument()
    expect(mockedMessages).not.toHaveBeenCalled()
  })

  it('carrega as últimas 50 mensagens ao abrir a turma', async () => {
    mockedMessages.mockResolvedValue({
      mensagens: [makeMessage()],
      has_more: false,
    })
    renderRoom()
    await waitFor(() => expect(mockedMessages).toHaveBeenCalledWith('t-1', { limit: 50 }))
    expect(await screen.findByText('Bem-vindos à turma!')).toBeInTheDocument()
    expect(screen.getByText('Futsal Sub-13')).toBeInTheDocument()
    expect(screen.getByText(/12 membro/)).toBeInTheDocument()
  })

  it('mostra o nome do autor acima da bolha de outro usuário, e não na própria', async () => {
    mockedMessages.mockResolvedValue({
      mensagens: [
        makeMessage(),
        makeMessage({ id: 'm-2', autor_id: ME, autor_nome: 'Eu Mesmo', autor_tipo: 'aluno', texto: 'Obrigado, professora!' }),
      ],
      has_more: false,
    })
    renderRoom()

    await screen.findByText('Bem-vindos à turma!')
    // Autor do outro aparece sobre a bolha (com o sufixo "· Professor").
    expect(screen.getByText(/Ana Souza · Professor/)).toBeInTheDocument()
    expect(screen.queryByText('Eu Mesmo')).toBeNull() // própria mensagem não repete o nome
    expect(screen.getByText('Obrigado, professora!')).toBeInTheDocument()
  })

  it('envia uma mensagem e aparece na lista (optimista, sem recarregar)', async () => {
    mockedMessages.mockResolvedValue({ mensagens: [], has_more: false })
    mockedSend.mockResolvedValue(makeMessage({ id: 'm-novo', autor_id: ME, autor_nome: 'Eu', texto: 'Olá turma!' }))
    renderRoom()
    await waitFor(() => expect(mockedMessages).toHaveBeenCalled())

    const input = screen.getByLabelText('Nova mensagem')
    fireEvent.change(input, { target: { value: 'Olá turma!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('t-1', 'Olá turma!'))
    expect(await screen.findByText('Olá turma!')).toBeInTheDocument()
  })

  it('não envia mensagem vazia (só espaços)', async () => {
    renderRoom()
    await waitFor(() => expect(mockedMessages).toHaveBeenCalled())

    const input = screen.getByLabelText('Nova mensagem')
    fireEvent.change(input, { target: { value: '   ' } })
    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' })
    expect(sendButton).toBeDisabled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('restaura o rascunho quando o envio falha', async () => {
    mockedSend.mockRejectedValue(new Error('offline'))
    renderRoom()
    await waitFor(() => expect(mockedMessages).toHaveBeenCalled())

    const input = screen.getByLabelText('Nova mensagem')
    fireEvent.change(input, { target: { value: 'mensagem que falha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    await waitFor(() => expect(mockedSend).toHaveBeenCalled())
    // O texto volta para o input (o usuário não perde o que escreveu).
    await waitFor(() => expect(input).toHaveValue('mensagem que falha'))
  })

  it('refetcha apenas o delta quando o revision sobe (tempo real)', async () => {
    mockedMessages.mockResolvedValue({ mensagens: [makeMessage()], has_more: false })
    const { rerender } = renderRoom({ revision: 0 })
    await waitFor(() => expect(mockedMessages).toHaveBeenCalledTimes(1))

    mockedMessages.mockResolvedValue({
      mensagens: [makeMessage({ id: 'm-2', texto: 'Mensagem nova em tempo real' })],
      has_more: false,
    })
    rerender(
      <ChatRoom
        turmaId="t-1"
        turmaNome="Futsal Sub-13"
        totalMembros={12}
        myUserId={ME}
        myRole="aluno"
        live={true}
        revision={1}
      />,
    )

    await waitFor(() => {
      // Delta fetch: usa after= com o timestamp da última mensagem conhecida.
      expect(mockedMessages).toHaveBeenLastCalledWith('t-1', { after: '2026-10-07T12:00:00+00:00' })
    })
    expect(await screen.findByText('Mensagem nova em tempo real')).toBeInTheDocument()
    // A mensagem antiga permanece (sem duplicar, sem recarregar tudo).
    expect(screen.getByText('Bem-vindos à turma!')).toBeInTheDocument()
  })

  it('exibe o botão "carregar mais" quando há histórico anterior', async () => {
    mockedMessages.mockResolvedValue({
      mensagens: [makeMessage()],
      has_more: true,
    })
    renderRoom()
    const older = await screen.findByRole('button', { name: /carregar mensagens antigas/i })

    mockedMessages.mockResolvedValue({
      mensagens: [makeMessage({ id: 'm-0', texto: 'Mensagem bem antiga' })],
      has_more: false,
    })
    fireEvent.click(older)

    await waitFor(() => {
      // Paginação do histórico: usa before= com o timestamp da mais antiga.
      expect(mockedMessages).toHaveBeenLastCalledWith('t-1', { before: '2026-10-07T12:00:00+00:00', limit: 50 })
    })
    expect(await screen.findByText('Mensagem bem antiga')).toBeInTheDocument()
  })

  it('mostra erro quando o carregamento inicial falha', async () => {
    mockedMessages.mockRejectedValue(new Error('Serviço indisponível'))
    renderRoom()
    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument()
    expect(screen.getByText('Serviço indisponível')).toBeInTheDocument()
  })
})
