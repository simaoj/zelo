# Zelo — PWA, offline e push

Este documento cobre a instalação, o uso offline, o fluxo de atualização e o Web Push do app web (`apps/web`), conforme a §9 da spec.

## Arquitetura em uma página

| Peça | Onde | Observações |
| --- | --- | --- |
| Manifest | `src/app/manifest.ts` → `/manifest.webmanifest` | `id "/"`, `start_url "/hoje"`, `display standalone`, `lang pt-BR`, fundo `#FFFCF8` |
| Ícones | `public/icons/*` (gerados por `scripts/generate-icons.mjs`) | 192/512 `any`, 192/512 `maskable` (logo em ~66% da largura, dentro da zona segura de 80%), apple-touch-icon 180. Logo com `fit: inside` sobre fundo da marca, sem distorção |
| Metadados | `src/pwa/metadata.ts` (`pwaMetadata`, `pwaViewport`) | usados por `src/app/layout.tsx` |
| Service worker | `src/pwa/sw/sw.ts` → `public/sw.js` | empacotado por `serwist build scripts/serwist.config.mjs` **depois** de `next build` |
| Registro do SW + atualização | `src/pwa/sw-client.ts`, `UpdateBanner` | só em produção, em HTTPS ou localhost |
| Camada offline | `src/infrastructure/offline/*` | `createOfflineDataLayer(http, auth)` → `{ data, sync, auth }` |
| UI | `src/pwa/components/*` | `SyncStatusBadge`, `ConflictCenter`, `InstallPrompt`, `UpdateBanner`, `OfflineSettings`, `PushSettings`, `SignOutDialog` |

### Build do service worker (Next 16 + Turbopack)

O Next 16 compila com Turbopack por padrão e o plugin webpack do `@serwist/next` não roda nele. Usamos o **modo configurador do Serwist**: `next build` (Turbopack) e, em seguida, `serwist build scripts/serwist.config.mjs`, que:

- empacota `src/pwa/sw/sw.ts` com esbuild em `public/sw.js` (ignorado no git);
- injeta o manifesto de precache: `.next/static/**` (assets versionados por hash), `public/**` e o HTML **pré-renderizado** (estático) das rotas.

O HTML pré-renderizado é gerado no build sem cookies nem requisição do usuário, então não contém dados pessoais: é o app shell. O script `build` do `apps/web/package.json` já faz as duas etapas, e o Dockerfile só precisa rodar `pnpm --filter @zelo/web build` antes de copiar `public/`.

### Regras de cache

- **Precache**: apenas o app shell e os assets versionados. Caches antigos são removidos na ativação (`cleanupOutdatedCaches` + limpeza de caches desconhecidos).
- **`/api/*`**: sempre network-only. Nenhuma resposta autenticada nem dado de saúde vai para o Cache Storage.
- **Navegações**: se a rota foi precacheada, vem do precache (versão consistente com os assets). Se não foi, vai para a rede **sem cachear**; offline, cai no shell precacheado (`/hoje`, depois `/`) ou numa página mínima "Você está offline".
- O SW não guarda tokens. A sessão é um cookie HttpOnly gerenciado pelo navegador.

## Testar a instalação

1. `docker compose up --build` e abra <http://localhost:3000> (localhost conta como contexto seguro).
2. Chrome/Edge (desktop ou Android): depois do `beforeinstallprompt`, o card "Instale o Zelo" mostra **Instalar Zelo**. Sem o evento, mostra instruções da plataforma.
3. iOS/iPadOS Safari: aparecem as instruções **Compartilhar → Adicionar à Tela de Início** (o iOS não dispara `beforeinstallprompt`).
4. No app instalado (`display-mode: standalone`) o card some. O app continua utilizável no navegador sem instalação.
5. DevTools → Application → Manifest/Service Workers para conferir ícones, `id`, `scope` e o SW ativo. `next dev` **não** registra SW: valide sempre com o build de produção.

## Testar o offline

O uso offline de dados pessoais é **opt-in por dispositivo**: Configurações → "Usar offline neste dispositivo". O flag fica no `localStorage` (`zelo-offline-enabled`).

- **Desativado**: a camada repassa tudo para o HTTP e nada pessoal é gravado localmente. Sem rede, o shell abre e mostra o estado de conexão.
- **Ativado**: cria o IndexedDB `zelo-<userId>` (Dexie), baixa `/sync/bootstrap` e depois segue `/sync/changes?cursor=…` (upserts e tombstones). As leituras (históricos com paginação e período, deltaKg, estado das ocorrências, dashboard) são feitas localmente com a mesma semântica do servidor.
- **Mutações offline permitidas**: peso, medidas e pressão (criar, editar, excluir), **água (criar, editar, excluir)**, tomada de ocorrência (registrar ou desfazer) e tomada avulsa. A alteração local e a operação na fila são gravadas **na mesma transação** e o retorno é `{ persistence: 'local' }` ("Salvo neste dispositivo"). `'server'` só é retornado depois da confirmação do servidor. Programações, conta, metas (peso, água e passos), perfil e push exigem conexão (`OfflineError`).
- **Sincronização**: ao abrir, no evento `online`, ao voltar a aba visível, em "Sincronizar agora" e por mensagem opcional do SW (Background Sync tag `zelo-sync`, que só pede às abas que sincronizem; o fluxo não depende dele). A fila vai em ordem, uma operação por entidade por rodada, e operações encadeadas (criar → editar → excluir offline) são rebaseadas na versão confirmada pelo servidor.
  - rede, 5xx ou 429 → backoff exponencial com jitter (2 s a 5 min);
  - 401 → fila pausada e `needsReauth` ("Sessão expirada");
  - 409 `VERSION_CONFLICT` → conflito com a versão do servidor guardada;
  - 400/422/404 e `IDEMPOTENCY_CONFLICT` → erro visível para correção.
- **Conflitos**: na Central de sincronização (badge → "Resolver conflitos"), a versão local e a do servidor aparecem lado a lado. As opções são "Manter versão do servidor" ou "Reaplicar minha edição", que reenvia com `expectedVersion` igual à versão atual do servidor e um novo `operationId`. Nunca há last-write-wins silencioso.

### Água offline

A água usa **a mesma fila e o mesmo motor** das medições (operações `water.create`, `water.update` e `water.delete` do contrato `SyncOperation`). Não existe uma segunda fila nem outra estratégia de sincronização.

- Botão rápido (200, 300 ou 500 ml) ou formulário offline: o registro vai para a tabela `waterEntries` e a operação para a fila na mesma transação. O retorno é `{ persistence: 'local' }` e a UI mostra "Salvo neste dispositivo". Online, sem nada pendente para o registro, vai direto ao servidor (`'server'`). Se a rede cair no meio, o registro entra na fila com o **mesmo** `operationId`, e o servidor é idempotente.
- **Desfazer** antes de sincronizar: o motor envia `water.create` e depois `water.delete` em ordem, com o delete rebaseado na versão confirmada. O resultado final no servidor é nenhum registro e nenhum create "solto".
- Conflitos (`409 VERSION_CONFLICT`) aparecem na Central como "Edição de água" ou "Exclusão de água", com os campos "Quantidade (ml)" e "Horário".
- Total diário, histórico e gráficos offline agrupam pelo **fuso do perfil** (o perfil está em cache) com a mesma semântica do servidor: `totalMl: null` em dia sem registros (nunca 0) e média só dos dias com registros.

### Atividade (passos e exercícios): cache somente leitura

Os dados de passos e exercícios chegam ao servidor pelo Auto Export do iPhone (`POST /imports/health`). O PWA **não conversa com o iPhone**: o SW não tem tarefa de importação e não existe fila de importação no front. Com o offline ativado, `dailySteps`, `workouts` e `activityGoal` são replicados pelo mesmo `/sync/bootstrap` + `/sync/changes` (upserts e tombstones) e ficam consultáveis sem rede:

- passos por dia (`count: null` = sem dados, `0` = zero informado, `partial` = hoje no fuso do perfil), média só dos dias com dados e `lastReceivedAt`;
- lista de exercícios (período, modalidade, paginação) e detalhes;
- o bloco de atividade do Hoje.

A UI mostra a data do último recebimento (`lastReceivedAt`), porque offline os dados valem **só até a última sincronização**. Nada de atividade é enfileirado. A meta de passos só muda online.

### Schema local

- v1: tabelas iniciais. v2: `drafts` e índice `ownerUserId` na fila.
- v3: `waterEntries`, `hydrationGoal`, `dailySteps`, `activityGoal` e `workouts`. A migração é aditiva: os dados e as operações pendentes ficam intactos. Em um DB já inicializado, ela marca `forceBootstrap` para baixar água e atividade na próxima sincronização, e a fila pendente é preservada (`keepIds`).

Roteiro manual: ative o offline, abra Corpo, em DevTools → Network marque *Offline*, recarregue (o shell abre), registre um peso (badge "1 pendente"), feche e reabra a aba, desmarque *Offline* e confira em `/api/v1/weights` que existe **um** registro.

### Conta e logout

- O DB é por conta. A fila só é enviada se `ownerUserId` for igual ao usuário da sessão atual.
- **Troca de conta**: se a conta anterior não tem pendências, o DB dela é apagado e o opt-in de offline é zerado. Se tem pendências, os dados **não** são mostrados à nova conta nem descartados em silêncio: ficam isolados e a Central oferece "Descartar dados da outra conta" (ou entre de novo com a conta anterior para sincronizar).
- Água e atividade ficam no mesmo DB da conta, então são apagadas junto com ele no logout, na troca de conta e em "Apagar dados locais".
- **Logout** (`auth.signOut()` embrulhado): com pendências, abre o diálogo **Sincronizar e sair / Cancelar / Descartar e sair**. "Cancelar" lança `SignOutCancelledError` (use `isSignOutCancelled(e)` de `@/pwa`). Depois remove a subscription push deste dispositivo (`DELETE /push-subscriptions/:id` + `unsubscribe()`), revoga a sessão no servidor, apaga o IndexedDB e as caches em memória e desliga o opt-in.
- **Logout offline**: limpa tudo localmente e grava `zelo-pending-revocation=1` (não é token). No próximo `online`, `getSession` ou `signIn`, o `POST /auth/sign-out` roda **antes** de qualquer nova sessão online.

## Fluxo de atualização

1. Um novo `sw.js` instala e fica em *waiting* (o SW nunca chama `skipWaiting` sozinho).
2. `UpdateBanner` mostra "Nova versão disponível".
3. Em **Atualizar**, se houver edição em andamento (`pwaGuards`) ou sincronização rodando, a atualização é recusada com uma mensagem. Caso contrário, envia `SKIP_WAITING` e recarrega no `controllerchange`.
4. O IndexedDB (fila, inclusive operações de água pendentes, dados e tabela `drafts`) não é afetado. O schema é versionado com migrações aditivas (v1 → v2 → v3 em `db.ts`).

### `pwaGuards`: marcar formulários sujos

```ts
import { useEditingGuard, pwaGuards } from '@/pwa';
useEditingGuard(isDirty);                     // hook (recomendado)
pwaGuards.markEditing('peso'); pwaGuards.clearEditing('peso');
// ou: <form data-zelo-editing={isDirty ? 'true' : undefined}>
```

## Web Push

- As chaves VAPID estão no `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). O front lê a chave pública em `GET /api/v1/push-subscriptions/config`. Chave `null` → "não disponível neste servidor".
- `PushSettings` detecta `serviceWorker`, `PushManager` e `Notification`. A permissão só é pedida **depois do clique** em "Ativar notificações". A subscription vai para `POST /push-subscriptions` com o `deviceId` (`getDeviceId()`, `localStorage zelo-device-id`). "Desativar notificações" faz DELETE e `unsubscribe()`.
- O SW mostra título e corpo genéricos (padrão "Você tem um cuidado programado no Zelo") e nunca expõe medicamento, dose ou medida. O clique abre ou foca `/rotina` e **não** confirma tomada.
- Para testar: ative em Configurações (build de produção), depois DevTools → Application → Service Workers → *Push* com `{"title":"Zelo","body":"Você tem um cuidado programado no Zelo"}`.

## Testes

- Unitários e integração da camada offline (vitest + fake-indexeddb):
  `pnpm --filter @zelo/web exec vitest run --config scripts/vitest.offline.config.ts`
  Cobrem a atomicidade da escrita local + fila; a criação offline que sobrevive a uma nova instância e sincroniza **uma** vez; o replay de resposta perdida sem duplicar; a ordem criar → editar → excluir com rebase de versão; 401 pausando a fila; 5xx/backoff; 422 visível; 409 com as duas resoluções; tombstone; troca de conta; logout com escolha obrigatória; logout offline com revogação no reconectar; remoção da subscription push; migração de schema v1 → v2 → v3 (dados e fila preservados); e as consultas locais (deltaKg, paginação, estado da ocorrência, dashboard).
  Para água e atividade: criação offline → nova instância → reconexão com **um** envio e o mesmo `operationId`; replay de resposta perdida; ordem criar → editar → excluir; desfazer antes de sincronizar; 409 com as duas resoluções; tombstone de água e de exercício; entidades desconhecidas ignoradas; resumo de água perto da meia-noite (23:59 / 00:01 no fuso do perfil) e ausência ≠ zero; passos parciais, sem dados ou zero; filtro e paginação de exercícios; metas só online; passthrough de todos os métodos novos com o offline desligado; logout e troca de conta apagando as tabelas novas.
- E2E (Docker, build de produção em <http://localhost:3000>):
  `pnpm --filter @zelo/web exec playwright test -c e2e/playwright.pwa.config.ts`
  Cobre o manifest, o SW (cabeçalhos e nada de `/api` no Cache Storage) e o fluxo offline completo com verificação via API de um único registro sincronizado, tanto para peso quanto para água (+300 ml offline → recarregar offline → reconectar → um registro em `/water-entries`).

## Limitações conhecidas

- **Sem criptografia em repouso**: o IndexedDB não é criptografado pelo app. A tela de ativação avisa para usar só em dispositivo pessoal. O logout apaga os dados.
- **Push é melhor esforço**: depende do navegador, do sistema, da conexão e do serviço de push. Não há alarmes offline com o app fechado. Os lembretes dentro do app funcionam sem push.
- **iOS/iPadOS**: Web Push só com o app instalado na Tela de Início (iOS 16.4+). Não há `beforeinstallprompt` nem Background Sync. O armazenamento pode ser despejado pelo sistema se o app ficar sem uso.
- **Background Sync** é só uma otimização (Chromium). A sincronização roda ao abrir, ao reconectar e no botão.
- Rotas **dinâmicas** não precacheadas abrem offline com o shell de `/hoje`. As rotas do app devem continuar estáticas (dados buscados no cliente) para serem precacheadas.
- **Água**: o bootstrap traz os últimos **90 dias**. Registros mais antigos só aparecem offline se chegaram por `/sync/changes` depois da ativação. O histórico e o gráfico de 30 dias cabem na janela.
- **Atividade**: offline, passos e exercícios valem só até a última sincronização (a UI mostra o último recebimento), também com janela de **90 dias** no bootstrap. O "hoje parcial" reflete o último total recebido, não o atual do iPhone. Detalhe de um exercício fora da janela precisa de rede.
- Ocorrências fora da janela do bootstrap (±7 dias) só ficam disponíveis offline se foram consultadas online antes.
