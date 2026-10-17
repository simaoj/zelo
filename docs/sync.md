# Sincronização offline (API)

Este documento descreve o protocolo de sincronização entre o PWA e a API (`/api/v1/sync/*`).
Os formatos exatos estão em `packages/contracts/src/sync.ts`; o OpenAPI fica em `/api/v1/docs`.

## Garantias do servidor

| Garantia | Como é implementada |
| --- | --- |
| Sequência estável por usuário | Toda mutação de entidade sincronizável grava, **na mesma transação**, `syncCounters[userId].seq += 1` e uma linha em `changes {userId, seq, entity, entityId, op}` (`shared/adapters/mongo-change-log.ts`). Como todas as transações do mesmo usuário escrevem o mesmo contador, transações concorrentes conflitam e são repetidas: os números de sequência ficam ordenados por commit, sem buracos visíveis. |
| Snapshot + cursor consistentes | `GET /sync/bootstrap` lê o contador e todas as entidades em **uma única transação** com read concern `snapshot`. O cursor devolvido corresponde exatamente ao estado devolvido; nenhuma alteração concorrente é perdida. |
| Cursor opaco | `base64url("seq:<n>")`. Não depende do relógio do cliente. Cursores inválidos → 400. |
| Idempotência | Cada operação carrega `operationId`. `idempotencyKeys {userId, operationId, requestHash, responseStatus, responseBody}` é gravado na **mesma transação** da mutação (índice único `userId + operationId`). Mesmo id + mesmo payload → resposta armazenada (header `idempotent-replayed: true`); payload diferente → 409 `IDEMPOTENCY_CONFLICT`. As chaves não expiram. |
| Concorrência otimista | Edições/exclusões exigem `expectedVersion`; o filtro `{_id, userId, version}` com `$inc: {version: 1}` é atômico. Divergência → 409 `VERSION_CONFLICT` com `current` (representação atual) para a tela de conflito. Nunca há last-write-wins silencioso. |
| Isolamento | Toda leitura/mutação filtra pelo `userId` da sessão; `userId` no payload é ignorado; ids de outra conta → 404 (ou 409 sem dados, ao tentar criar com um id já usado). |
| Tombstones | Exclusões são lógicas (`deletedAt`) e aparecem em `/sync/changes` como `{op: "delete"}`. Não são removidas automaticamente nesta versão. |

## Fluxo do cliente

1. **Primeira carga** (após o usuário habilitar o modo offline): `GET /sync/bootstrap` → grava tudo no IndexedDB e guarda `cursor`.
2. **Envio da fila**: `POST /sync/operations` com até 100 operações, na ordem em que foram criadas (ordem por entidade preservada).
   - Cada operação é `{type, entityId, payload}` (`SyncOperation`). O servidor chama **o mesmo caso de uso** do endpoint REST correspondente, dentro do `IdempotentExecutor`.
   - A resposta traz um resultado por operação processada: `{operationId, status, body?, error?}`. `status` é o HTTP equivalente (201/200/204, 400, 404, 409, 422…).
   - O processamento para no primeiro 401 (sessão expirada): o cliente pausa a fila e pede login.
   - Uma operação inválida não impede as seguintes; seu erro de validação volta em `error.fieldErrors`.
   - O hash de idempotência é calculado sobre `{type, entityId, payload}` — o mesmo envelope usado pelos endpoints REST — então reenviar via REST uma operação já aplicada via sync (ou vice-versa) devolve a resposta original.
3. **Recebimento**: `GET /sync/changes?cursor=<cursor>` repetidamente enquanto `hasMore` for `true`, guardando o novo `cursor` a cada página (até 500 linhas do log por página).
   - As alterações vêm deduplicadas por entidade/id (a última vence) e resolvidas para o **estado atual**: `{op:"upsert", entity, id, data}` ou tombstone `{op:"delete", entity, id}`.
   - Como `data` é o estado atual, ele pode ser mais novo que o cursor; aplicar de novo depois é idempotente.

## Entidades

| `entity` | `id` | Observações |
| --- | --- | --- |
| `profile` | `userId` | singleton |
| `weightEntry` | id do registro | `deltaKg` é calculado no servidor; ao criar/editar/excluir um peso, o sucessor cronológico também é emitido como `upsert` porque sua variação muda |
| `weightGoal` | `userId` | singleton; `delete` quando a meta é removida |
| `measurementSession` | id da sessão | medidas embutidas; ausentes continuam ausentes |
| `bloodPressureEntry` | id do registro | `pulseBpm` pode ser `null` |
| `routineItem`, `occurrence`, `intakeRecord` | id | leitores/handlers fornecidos pelo módulo `routine` |

Operações offline suportadas: `weight.*`, `measurement.*`, `bloodPressure.*` (create/update/delete), `occurrence.intake.put`, `occurrence.intake.delete` e `intake.create` (módulo `routine`). Programações, conta e push exigem conexão.

## Erros de operação

| Código | Status | Ação sugerida no cliente |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | mostrar para correção |
| `UNAUTHENTICATED` | 401 | pausar fila, pedir login (sem trocar de conta com fila pendente) |
| `NOT_FOUND` | 404 | registro removido/inexistente: descartar após informar |
| `VERSION_CONFLICT` | 409 | abrir resolução: manter remoto (`current`) ou reaplicar com `expectedVersion = current.version` e **novo** `operationId` |
| `IDEMPOTENCY_CONFLICT` | 409 | bug do cliente (mesmo `operationId` com outro payload) |
| `CONFIRMATION_REQUIRED` | 422 | pressão com diastólica ≥ sistólica: pedir conferência e reenviar com `confirmedUnusual: true` e novo `operationId` |
