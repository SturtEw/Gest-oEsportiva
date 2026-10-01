# Segurança — Firebase Rules (Firestore + Storage)

Este diretório contém as regras de segurança do Firebase para o projeto `gestaoesportiva-9d8fa`.

## Arquivos

- `firestore.rules` — regras de acesso ao Firestore Database
- `storage.rules` — regras de acesso ao Cloud Storage
- `firebase.json` — mapeia os arquivos de regras para o Firebase CLI
- `.firebaserc` — vincula ao projeto Firebase correto

## Aplicar as regras no projeto

```bash
# Autenticar (se ainda não autenticado)
firebase login

# Revisar o que será aplicado (dry-run)
firebase deploy --only firestore:rules,storage --dry-run

# Aplicar de fato
firebase deploy --only firestore:rules,storage
```

> ⚠️ **IMPORTANTE:** verifique no Console Firebase → Firestore Database → *Rules* (e → Storage → *Rules*) se o projeto está no modo **"test mode"**. O modo test usa uma regra temporária com data de expiração que permite **acesso público total** — se esse for o caso, as regras deste repositório devem ser aplicadas **imediatamente**.

## Resumo do modelo de permissões

### Firestore
| Coleção | Leitura | Escrita |
|---|---|---|
| `users/{userId}` | apenas o dono | apenas o dono (`userId` imutável, payload validado) |
| `workouts/{workoutId}` | apenas o dono | apenas o dono (`userId` imutável, payload validado) |
| `public_workouts/{workoutId}` | qualquer usuário autenticado | negado (via Admin SDK/Functions apenas) |
| qualquer outra coleção | negado | negado |

### Storage
| Caminho | Leitura | Escrita |
|---|---|---|
| `users/{userId}/uploads/*` | apenas o dono + autenticados | apenas o dono (≤5 MB, imagens/PDF) |
| `users/{userId}/profile/*` | público (avatares) | apenas o dono (≤2 MB, imagens) |
| qualquer outro caminho | negado | negado |

## Mitigação de DDoS / Scraping

As regras do Firebase **não limitam taxa (rate limiting)**. Complementos recomendados:

1. **App Check** (reCAPTCHA v3 / Play Integrity) — bloqueia clientes não-oficiais. Ativar em *Firebase Console → App Check*.
2. **Orçamento e alertas** no Google Cloud Console (Billing → Budgets & Alerts) para detectar picos anômalos de leitura/escrita.
3. **Testes unitários de regras** com `@firebase/rules-unit-testing` + emulador:
   ```bash
   firebase emulators:exec --only firestore,storage "npm test"
   ```
4. Nunca remova o `allow read, write: if false` do `match /{document=**}` — ele garante "deny by default" para qualquer coleção futura não mapeada.

## Regra de ouro ao editar

Em regras do Firestore, permissões **se combinam** (não se sobrescrevem). Se uma regra genérica como `match /{document=**}` autorizar qualquer coisa, ela **anula** as regras específicas restritivas. Sempre mantenha o `deny by default` e adicione permissões granulares coleção por coleção.
