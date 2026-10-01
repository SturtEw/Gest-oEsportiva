# Login, cadastro e administração

## Perfis e estados

- **Aluno:** cadastro por e-mail/senha ou Google; conta ativa após o cadastro e sem turma até que a administração faça o vínculo.
- **Professor:** cadastro por e-mail/senha ou Google cria uma solicitação `pendente`. Nenhuma ferramenta docente fica acessível até a aprovação do administrador raiz. Reprovação exige um motivo.
- **Responsável:** não há cadastro público; a conta precisa ser provisionada e vinculada pela escola. O responsável pode alternar apenas entre alunos comprovadamente vinculados.
- **Administrador raiz:** usa a aba **Professor / administrador**, mas continua identificado como `admin` no servidor. Navegar por uma área para inspeção não assume a identidade do professor ou aluno.

A tela selecionada não autoriza o perfil: login, sessão, endpoints e WebSocket conferem o papel salvo no banco. Contas pendentes de professor só mantêm acesso à própria tela de status.

## Dados de documentos

O cadastro aceita tipo e número (CPF/RG/outro); não há upload de imagens. O backend normaliza o número, calcula um HMAC-SHA256 usando `DOCUMENT_HMAC_SECRET` e persiste somente o HMAC e os últimos quatro caracteres. O HMAC reduz exposição, mas o documento continua sendo dado pessoal: proteja a chave, restrinja o banco e defina prazo de retenção.

A coleta pública não comprova que a pessoa controla aquele endereço de e-mail. O cadastro de aluno fica ativo imediatamente conforme os requisitos; para implantação pública, adicionar verificação de e-mail ou código/invite da escola antes de conceder acesso continua recomendado.

## Google Identity

1. Crie um OAuth Web client ID no Google Cloud.
2. Configure os JavaScript origins de produção e desenvolvimento na credencial Google.
3. Defina `GOOGLE_CLIENT_ID` privadamente no backend e, opcionalmente, em `VITE_GOOGLE_CLIENT_ID` no build do frontend.
4. O frontend só exibe o botão se houver configuração pública; o backend valida assinatura, audience, expiração e `email_verified` usando `google-auth`.
5. Não configure `client_secret` no frontend. Google sign-in não altera papel nem estado administrativo.

A ligação entre uma conta Google e uma conta existente exige e-mail verificado correspondente; o backend registra o `sub` Google com índice único.

## Bootstrap do administrador raiz

1. Instale os requisitos: `pip install -r backend/requirements.txt`.
2. Configure `JWT_SECRET`, `MONGO_URL`, `DB_NAME`, `ROOT_ADMIN_EMAIL`, `ROOT_ADMIN_NAME` e `ROOT_ADMIN_PASSWORD` (ou `ROOT_ADMIN_INITIAL_PASSWORD` para compatibilidade) num ambiente privado.
3. A senha inicial deve ser forte e diferente da credencial exposta no pedido; não a copie para repositório, testes ou logs. Rotacione qualquer segredo compartilhado no chat.
4. A partir de `backend/`, execute `python scripts/bootstrap_root_admin.py` uma vez.
5. O script recusa sobrescrever conta existente e persiste somente o hash da senha. Remova a variável de senha inicial depois do bootstrap.

O código de inicialização da API não cria conta administrativa automaticamente.

## Administração e aprovação

O administrador raiz pode:
- consultar a fila de professores pendentes e ver documento apenas mascarado;
- aprovar ou reprovar (a reprovação recebe justificativa); decisões gravam uma linha em `admin_audit`;
- criar uma turma e vincular alunos sem turma, respeitando a capacidade configurada;
- consultar turma/aluno por projeção explicitamente somente leitura, sem impersonação.

Não existe envio externo de e-mail implementado nesta entrega; a submissão cria uma notificação interna para a fila do administrador. Não considerar a notificação como e-mail enviado.

## Configuração e dados existentes

Copie `backend/.env.example` para `backend/.env` fora do controle de versão e substitua os marcadores. Valores incluídos são apenas nomes/placeholders; nenhuma credencial real foi adicionada.

Antes da produção, faça backup e migre documentos antigos armazenados em `cpf` para HMAC. A chave usada para HMAC deve ser mantida separada do banco e não pode ser perdida sem um plano de migração. Índices únicos legados precisam ser revisados antes de criar os novos.

## Sincronização em tempo real

A API usa WebSockets e MongoDB Change Streams para enviar somente uma invalidação de seção (nunca o documento) às conexões autorizadas. Change Streams de cluster exigem MongoDB configurado como replica set; MongoDB Atlas normalmente oferece esse recurso. Sem replica set, a API indica explicitamente a limitação `single_worker`: alterações locais publicadas pelo mesmo processo podem chegar ao navegador, mas alterações feitas por outros processos/instâncias não são sincronizadas em nuvem. Para produção horizontal sem Change Streams, configure uma camada compartilhada de pub/sub antes de prometer sincronização distribuída.

## Execução local

- Frontend: `cd student-portal`, `npm install`, `npm run dev`.
- Backend: configure `backend/.env`, instale `backend/requirements.txt`, depois rode a partir de `backend/`: `uvicorn server:app --reload --port 8000`.
- Vite encaminha `/api` e WebSocket para `http://127.0.0.1:8000`.

O ambiente de edição usado para esta entrega não possui Python instalado. Os arquivos backend foram criados/alterados, mas precisam de testes de importação, rotas, MongoDB e Google OAuth num runtime Python antes de produção.
