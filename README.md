# Zelo — Seu cuidado, dia a dia

PWA responsivo (pt-BR) para acompanhar peso, medidas, pressão arterial e a rotina de
medicamentos, vitaminas e suplementos. Sem refeições, dieta ou calorias.

| Parte | Tecnologia | Pasta |
| --- | --- | --- |
| Frontend (aplicação independente) | Next.js 16 + React 19 + TypeScript + Tailwind 4, PWA (Serwist), IndexedDB (Dexie) | `apps/web` |
| Backend (aplicação independente) | Node.js 24 + Fastify 5 + TypeScript, arquitetura hexagonal, monólito modular | `apps/api` |
| Worker de lembretes | Mesmo projeto do backend, processo separado | `apps/api/src/bootstrap/worker.ts` |
| Contratos compartilhados | Schemas zod + tipos de transporte (sem banco/framework) | `packages/contracts` |
| Banco | MongoDB 8.2 em replica set (`rs0`) | — |

Documentação complementar: [`docs/sync.md`](docs/sync.md) (protocolo de sincronização) ·
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

## Arquitetura

Backend (`apps/api/src`): `modules/{identity,profile,body,blood-pressure,routine,dashboard,notifications,sync}`, cada um com
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
- Identidade visual: logo e paleta Tropical Punch em `assets/brand` / `apps/web/public/brand`; telas baseadas nos mockups Stitch (`stitch_zelo_sa_de_e_bem_estar/`), sem os cartões de hidratação/refeição e classificações clínicas presentes nos mockups.
