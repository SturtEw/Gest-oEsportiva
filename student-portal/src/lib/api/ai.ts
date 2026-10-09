/** Canal privado de dúvidas com a IA (aluno/professor). */

import { request } from './client'

export interface IaMessage {
  id: string
  papel: 'user' | 'assistant'
  texto: string
  criado_em: string
  /** 'gemini' | 'local' | 'user' */
  fonte: string
}

export const aiApi = {
  iaHistory: (revision = 0) =>
    request<{ mensagens: IaMessage[]; ia_disponivel: boolean }>(`/api/ia/historico?revision=${revision}`),
  iaAsk: (mensagem: string) =>
    request<{ pergunta: IaMessage; resposta: IaMessage; ia_disponivel: boolean }>('/api/ia/chat', {
      method: 'POST',
      body: JSON.stringify({ mensagem }),
    }),
  iaClear: () => request<{ removidas: number }>('/api/ia/historico', { method: 'DELETE' }),
}
