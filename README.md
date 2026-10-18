# Zelo — Seu cuidado, dia a dia

PWA responsivo (pt-BR) para acompanhar peso, medidas, pressão arterial, água, passos e exercícios
(recebidos do app **Health Auto Export** no iPhone) e a rotina de medicamentos, vitaminas e suplementos.
Sem refeições ou dieta (as únicas calorias exibidas são as calorias ativas dos exercícios recebidos).

| Parte | Tecnologia | Pasta |
| --- | --- | --- |
| Frontend (aplicação independente) | Next.js 16 + React 19 + TypeScript + Tailwind 4, PWA (Serwist), IndexedDB (Dexie) | `apps/web` |
| Backend (aplicação independente) | Node.js 24 + Fastify 5 + TypeScript, arquitetura hexagonal, monólito modular | `apps/api` |
| Worker de lembretes | Mesmo projeto do backend, processo separado | `apps/api/src/bootstrap/worker.ts` |
| Contratos compartilhados | Schemas zod + tipos de transporte (sem banco/framework) | `packages/contracts` |
| Banco | MongoDB 8.2 em replica set (`rs0`) | — |

Documentação complementar: [`docs/sync.md`](docs/sync.md) (protocolo de sincronização) ·
[`docs/activity-import.md`](docs/activity-import.md) (contrato de recebimento do Auto Export) ·
[`docs/pwa.md`](docs/pwa.md) (instalação, offline, atualização, push) · OpenAPI em
`http://localhost:4000/api/v1/docs` (JSON em `/api/v1/openapi.json`).

## Executar com Docker (recomendado)

Pré-requisitos: Docker com Compose v2.

```bash
cp .env.example .env
# gere chaves VAPID para Web Push e cole em .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY):
pnpm install && pnpm --filter @zelo/api exec web-push generate-vapid-keys
docker compose up -d --build
```

| Serviço | Endereço | Papel |
| --- | --- | --- |
| web | http://localhost:3000 | App Next.js (encaminha `/api/*` para a API — mesma origem, sem CORS) |
| api | http://localhost:4000 | API REST `/api/v1` |
| worker | — | Agenda e envia lembretes Web Push (lease + deduplicação) |
| migrate | — | Cria índices de forma idempotente e encerra |
| mongo | localhost:27017 | MongoDB 8.2, replica set de um nó inicializado pelo healthcheck |
| mailpit | http://localhost:8025 | Caixa de e-mail local (links de recuperação de acesso) |

Dados fictícios de demonstração (opcional): `docker compose exec api node apps/api/dist/bootstrap/seed.js`
→ entre com `demo@zelo.local` / `zelo-demo-123`.

> **Por que MongoDB 8.2?** O `mongo:8.0` não inicia em kernels Linux ≥ 6.19 (SERVER-121912), comum no Docker Desktop recente.

## Desenvolvimento sem Docker para as aplicações

```bash
pnpm install
docker compose up -d mongo mailpit            # só a infraestrutura
pnpm --filter @zelo/contracts build
# no .env (ou no shell) use MONGODB_URI=mongodb://localhost:27017/zelo?replicaSet=rs0&directConnection=true
#                         SMTP_URL=smtp://localhost:1025  COOKIE_SECURE=false  NODE_ENV=development
pnpm --filter @zelo/api db:migrate
pnpm dev:api      # :4000
pnpm dev:worker
pnpm dev:web      # :3000 (rewrite /api → http://localhost:4000)
```

O service worker só é registrado em build de produção (`pnpm --filter @zelo/web build && pnpm --filter @zelo/web start`).

## Testes e verificação

```bash
pnpm typecheck && pnpm lint
pnpm --filter @zelo/api test          # unit + integração (MongoDB em memória como replica set)
pnpm --filter @zelo/web test          # unit/componentes + IndexedDB (fake-indexeddb)
docker compose up -d --build && pnpm --filter @zelo/web test:e2e   # Playwright contra a stack Docker
```

Os E2E criam várias contas seguidas a partir do mesmo IP, e a API limita login/cadastro a
10 requisições por minuto por IP. Para a suíte completa, suba a API com um limite maior **só
durante os testes** e volte ao padrão depois:

```bash
AUTH_RATE_LIMIT_MAX=200 docker compose up -d api
E2E_BASE_URL=http://localhost:3100 pnpm --filter @zelo/web exec playwright test --workers=1
E2E_BASE_URL=http://localhost:3100 pnpm --filter @zelo/web exec playwright test -c e2e/playwright.pwa.config.ts --workers=1
docker compose up -d api   # volta ao padrão (10/min)
```

Cobertura principal: regras de domínio (decimais, medidas, datas, horário de verão, estados de
tomada, versionamento de programação), casos de uso com portas fake, integração com replica set
(índices, transações, isolamento entre contas, idempotência, conflitos de versão, tombstones,
lease de jobs), teste de fronteiras arquiteturais e E2E (CRUD de peso, pressão sem pulso,
tomar/desfazer, layout em 320/390/768/1440 px, offline/reconexão).

## Testar o PWA, offline e push

Resumo — detalhes em [`docs/pwa.md`](docs/pwa.md):

1. Abra http://localhost:3000 (localhost conta como contexto seguro). Em navegadores com suporte aparece **Instalar Zelo** em Configurações; no iOS siga as instruções exibidas (Compartilhar → Adicionar à Tela de Início).
2. Em **Configurações → Usar offline neste dispositivo**, habilite e aguarde a primeira sincronização.
3. DevTools → Network → Offline. Recarregue: o app abre; registre um peso (aparece “Salvo neste dispositivo” e a contagem de pendentes).
4. Volte a ficar online: a fila sincroniza uma única vez (idempotência por `operationId`).
5. Push: em Configurações → Lembretes, ative as notificações (o navegador pede permissão só após o clique). O worker envia o texto genérico “Você tem um cuidado programado no Zelo”.

## Água

Registro manual em ml (botões rápidos 200/300/500 ml com desfazer, quantidade personalizada, data e
horário retroativos — nunca futuros), edição, exclusão, total diário no fuso do perfil, meta diária
opcional definida pelo usuário e histórico/gráfico de 7 e 30 dias. Dias sem registros aparecem como
“sem registros”, nunca como zero. Funciona offline pela mesma fila de operações dos demais registros
(`water.create/update/delete`, idempotentes por `operationId`).

## Atividade (passos e exercícios via Health Auto Export)

O fluxo é **somente recebimento**: `iPhone / Auto Export → POST autenticado → API Zelo → MongoDB`.
Toda a configuração, periodicidade e execução dos envios acontece no Auto Export. O Zelo não busca
dados no iPhone, não agenda nada, não tem tela de integração nem botão de “sincronizar”; as telas
apenas consultam o que já foi recebido. Passos e exercícios são somente leitura.

### Endpoint

```http
POST https://<host>/api/v1/imports/health
Authorization: Bearer <token de integração>
Content-Type: application/json
```

- Autenticação **apenas** pelo token de integração (o cookie de sessão é ignorado e não há CSRF nessa rota).
  O usuário vem da credencial; qualquer `userId` no JSON é ignorado.
- Corpo máximo: **5 MB** (`HEALTH_IMPORT_MAX_BYTES`). Rate limit: balde de escrita (120 req/min por IP).
- Headers do Auto Export (`automation-id`, `automation-name`, `automation-aggregation`, `automation-period`,
  `session-id`) são tratados só como metadados de log; nunca autenticam nem deduplicam. Os logs contêm
  apenas contagens, ids e esses metadados — nunca o payload nem o token.

| Status | Quando |
| --- | --- |
| 200 | Processado: `{"status":"ok","steps":{"inserted","updated","unchanged"},"workouts":{...}}` com contadores reais |
| 400 | JSON/estrutura/campos inválidos (`fieldErrors` por caminho, ex.: `data.workouts.0.distance.units`), unidade desconhecida, passos não inteiros |
| 401 | Token ausente, inválido ou revogado |
| 413 | Corpo acima de 5 MB |
| 415 | `Content-Type` diferente de `application/json` |
| 422 | Formato válido, mas não é total diário consolidado (ex.: o mesmo dia mais de uma vez no lote) |
| 500 | Falha inesperada de persistência — nada do lote fica gravado; reenviar é seguro |

Todo o lote é validado antes de gravar e gravado numa única transação. Reenvios são seguros:
passos fazem upsert por `{usuário, provedor, data local}` e exercícios por `{usuário, provedor, id exportado}`,
com a política **“último recebimento substitui”** (sem `$inc`, sem somar, sem apagar dias/exercícios ausentes).
Detalhes em [`docs/activity-import.md`](docs/activity-import.md).

### Tokens de integração (script administrativo, sem tela)

Só o hash SHA-256 do token é armazenado; o token é exibido **uma única vez** na criação.

```bash
# local (a partir da raiz do repositório)
pnpm --filter @zelo/api integration-token create --email voce@exemplo.com --label "iPhone"
pnpm --filter @zelo/api integration-token list   --email voce@exemplo.com
pnpm --filter @zelo/api integration-token revoke --id <id do token>

# Docker
docker compose exec api node apps/api/dist/bootstrap/integration-token.js create --email voce@exemplo.com --label "iPhone"
docker compose exec api node apps/api/dist/bootstrap/integration-token.js list --email voce@exemplo.com
docker compose exec api node apps/api/dist/bootstrap/integration-token.js revoke --id <id do token>
```

### Configuração esperada no Health Auto Export

Crie **duas automações REST API** no app, ambas com:

- URL: `https://<host>/api/v1/imports/health` (a mesma nas duas);
- Formato **JSON**;
- Header `Authorization` = `Bearer <token>` configurado no próprio Auto Export (o token criado acima).

1. **Passos** — Data Type **Health Metrics**, métrica **Step Count** apenas; **Summarize Data ativado**;
   agrupamento (time grouping) **diário**; período (date range) **Default** — dia anterior completo + dia atual
   até o momento. **Não use “Since Last Sync”**: ele envia só o trecho desde o último envio, que o Zelo
   gravaria como se fosse o total do dia (a política é substituir, não somar).
2. **Exercícios** — Data Type **Workouts**, **Export Version 2**; rotas GPS (dados de rota) **desativadas**
   neste escopo (se vierem, são ignoradas e não são salvas).

O celular precisa alcançar a API pela rede: em casa, use o IP da máquina na LAN
(ex.: `http://192.168.0.10:4000/api/v1/imports/health`, sem HTTPS — o token trafega em claro na rede local);
fora dela, exponha a API por HTTPS (proxy reverso/túnel). O Zelo não oferece nada além disso para conectividade.
O dia atual aparece como parcial até o próximo envio; dias sem envio aparecem como “sem dados”.

## Arquitetura

Backend (`apps/api/src`): `modules/{identity,profile,body,blood-pressure,hydration,activity,integrations,routine,dashboard,notifications,sync}`, cada um com
`domain/` (TypeScript puro), `application/` (casos de uso + portas) e `adapters/{in/http,in/jobs,out/mongodb,out/notifications}`.
O composition root fica em `bootstrap/`. Regras de importação são verificadas por ESLint e por um teste de fronteiras.

Frontend (`apps/web/src`): `app/` (rotas), `features/` (telas), `shared/` (UI, hooks e portas de dados),
`infrastructure/http` (cliente da API), `infrastructure/offline` (IndexedDB, fila e sincronização), `pwa/` (service worker, instalação, atualização, push).
Componentes nunca acessam `fetch` ou IndexedDB diretamente — usam as portas de `shared/data/ports.ts`.

## Decisões e limitações

- Sessão em cookie HttpOnly (`SameSite=Lax`, `Secure` com `COOKIE_SECURE=true` atrás de HTTPS) + CSRF double-submit; senhas com argon2id.
- Dados locais offline **não são criptografados**; ficam só no dispositivo onde o modo offline foi habilitado e são apagados no logout/troca de conta.
- Web Push é melhor esforço: depende de navegador, sistema e conexão; no iOS exige o app instalado. Lembretes dentro do app funcionam sem push.
- Cadastro/edição de rotina, perfil, meta, conta e push exigem conexão nesta versão.
- Intervalos “a cada N horas” ficam fora desta versão (apenas horários fixos).
- Tombstones e chaves de idempotência não expiram nesta versão.
- Instantes futuros são rejeitados com tolerância de 60 s para diferença de relógio entre dispositivo e servidor.
- Nenhum diagnóstico ou classificação clínica é gerado.
- Atividade: só Health Auto Export (JSON, workouts v2, passos `step_count` em `count` consolidados por dia).
  Sem versão confiável na origem → “último recebimento substitui”. Valores dos headers `automation-*` não são
  validados (a documentação oficial não publica os valores literais). Tokens de integração só via script.
- Migração `2026-10-18-profile-visible-hydration-activity` (no serviço `migrate`): torna Água e Atividade
  visíveis nos perfis existentes uma única vez (marcador na coleção `migrations`).
- Identidade visual: logo e paleta Tropical Punch em `assets/brand` / `apps/web/public/brand`; telas baseadas nos mockups Stitch (`stitch_zelo_sa_de_e_bem_estar/`), sem os cartões de hidratação/refeição e classificações clínicas presentes nos mockups.
