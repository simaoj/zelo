# Zelo — Especificação para implementação

Versão 1.0 • 17/10/2026 • Interface em português do Brasil

## 1. Instrução ao coding agent

Implemente um web app responsivo e PWA chamado **Zelo**, com o conceito **“Seu cuidado, dia a dia”**. Entregue aplicação funcional, persistência real, autenticação, testes dos fluxos críticos e documentação de execução. Não entregue apenas telas ou mocks.

Requisitos definidos pelo proprietário:
- **Frontend React em aplicação separada**, usando Next.js com TypeScript.
- **Backend Node.js com TypeScript em aplicação independente**, expondo API HTTP.
- Persistência em **MongoDB**.
- **Arquitetura hexagonal**.
- **PWA**.
- Acompanhamento de peso, medidas, pressão arterial, medicamentos e vitaminas.
- **Sem refeições, dieta, calorias ou planejamento alimentar**.

Leia as instruções do repositório antes de alterar código. Reutilize padrões existentes compatíveis com estes requisitos. As bibliotecas citadas abaixo são propostas técnicas; documente substituições equivalentes. Não implante publicamente nem contrate serviços sem solicitação.

## 2. Stack e organização

| Parte | Proposta |
| --- | --- |
| Frontend | React + Next.js + TypeScript, aplicação independente |
| UI | Tailwind CSS e componentes acessíveis |
| Backend HTTP | Fastify + TypeScript |
| Banco | MongoDB, driver oficial encapsulado em adapters |
| PWA | Manifest e service worker no frontend Next.js, com Workbox ou integração compatível |
| Persistência offline | IndexedDB por adapter, podendo usar Dexie |
| Contratos | OpenAPI e schemas de validação na borda |
| Testes | Vitest e Playwright, ou equivalentes do projeto |
| Ambiente local | Docker Compose com API, web e MongoDB em replica set |

Fixar versões compatíveis no lockfile e consultar a documentação oficial durante a implementação. O backend será um monólito modular. Frontend e backend são aplicações distintas, com dependências, scripts de execução, builds e imagens Docker próprios. Podem compartilhar um monorepo, mas devem permitir execução e implantação independentes.

### Separação obrigatória entre frontend e backend

- **Frontend Next.js:** páginas, componentes React, navegação, formulários, gráficos, acessibilidade, manifest, service worker, IndexedDB e fila offline.
- **Backend Node.js/Fastify:** autenticação, autorização, regras de negócio, casos de uso, API REST, MongoDB, geração de ocorrências, sincronização e Web Push.
- O frontend consome a API do backend. Não acessa MongoDB nem importa adapters ou entidades internas do backend.
- Não implementar autenticação de negócio, CRUD, regras de domínio ou persistência em Route Handlers, API Routes ou Server Actions do Next.js. Essas responsabilidades ficam no backend Node.js.
- Recursos de servidor do Next.js podem renderizar a interface e consumir a API, preservando o contexto de autenticação e sem cache compartilhado de dados pessoais.
- No MVP, preferir carregamento de dados pessoais no cliente por um adapter HTTP, integrado ao cache IndexedDB. Manter renderização de servidor para o shell quando útil.
- Compartilhar apenas contratos de API e tipos de transporte em packages/contracts, sem dependências de banco ou framework.
- Configurar o endereço da API por ambiente. Para código do navegador, usar URL pública apropriada; nunca expor segredos em variáveis NEXT_PUBLIC_*.
- Em desenvolvimento, web e API executam em portas distintas. Preferir proxy/rewrite de /api para a API, sem introduzir lógica de negócio no proxy.
- Em produção, um reverse proxy pode encaminhar / para o frontend e /api para o backend, mantendo mesma origem pública sem fundir as aplicações.
- Se usar origens distintas, configurar CORS com allowlist explícita, credentials, cookies e proteção CSRF compatíveis; nunca usar origem curinga com credenciais.
- O service worker pertence ao frontend. O backend disponibiliza contratos de sync e gerencia envio de push; nenhum deles depende de executar dentro do processo Next.js.
- Worker de notificações pode executar como processo separado do mesmo projeto backend, reutilizando casos de uso e adapters.

Estrutura sugerida:

```text
apps/
  api/src/
    modules/
      identity/
      profile/
      body/
      blood-pressure/
      routine/
      notifications/
    bootstrap/
  web/src/
    features/
    shared/
    infrastructure/
    pwa/
packages/
  contracts/
infra/
  docker/
docs/
```

Dentro de cada módulo do backend:

```text
domain/
  entities/
  value-objects/
  errors/
application/
  ports/in/
  ports/out/
  use-cases/
adapters/
  in/http/
  in/jobs/
  out/mongodb/
  out/notifications/
```

### Regras da arquitetura hexagonal

- Domínio contém entidades, invariantes e objetos de valor em TypeScript puro.
- Domínio não importa Fastify, MongoDB, schemas HTTP ou bibliotecas de UI.
- Aplicação coordena casos de uso e depende de portas, não de adapters concretos.
- Controllers validam DTOs, obtêm identidade autenticada, chamam casos de uso e traduzem respostas.
- Repositories e mappers MongoDB ficam nos adapters de saída.
- IDs do domínio são strings UUID; ObjectId e documentos BSON não vazam para aplicação.
- Injeção de dependências ocorre no composition root em bootstrap.
- Usar portas para relógio, geração de IDs, repositórios, transações e notificações.
- Jobs e controllers chamam os mesmos casos de uso, sem duplicar regras.
- Contratos compartilhados não devem exportar documentos de persistência.
- No frontend, componentes não acessam IndexedDB diretamente: usar serviços/adapters de API, cache local e sincronização.

Portas sugeridas: WeightRepository, MeasurementRepository, BloodPressureRepository, RoutineRepository, OccurrenceRepository, IntakeRepository, UnitOfWork, Clock, IdGenerator e NotificationGateway.

Casos de uso centrais: RegisterWeight, RegisterMeasurements, RegisterBloodPressure, CreateRoutineItem, ReviseSchedule, ArchiveRoutineItem, GenerateOccurrences, RecordIntake, UndoIntake e GetDailyDashboard.

## 3. Identidade visual

Referências: logo fornecido em `zelo app.png` e imagem da paleta Tropical punch. Copiar os assets disponíveis para o projeto; não depender de caminhos temporários de outra sessão. Se ausentes, usar placeholder textual e documentar a substituição.

| Token | Cor | Uso |
| --- | --- | --- |
| brand-orange | #FF8243 | Ações principais e destaques |
| brand-pink | #FFC0CB | Cartões e superfícies |
| brand-yellow | #FCE883 | Cartões e detalhes |
| brand-teal | #069494 | Gráficos e complementos |
| background | #FFFCF8 | Fundo sugerido |
| surface | #FFFFFF | Superfícies |
| text | #202020 | Texto principal |

- Preservar lettering e proporções do logo original.
- Fundo claro, espaço em branco, bordas discretas, sombras suaves.
- Cartões arredondados em aproximadamente 20 px e campos em 12 px.
- Fonte sem serifa legível, como Inter; números tabulares nos indicadores.
- Texto escuro sobre laranja, rosa e amarelo; verificar contraste real.
- Ícones acompanhados de rótulos. Cor não é o único sinal de estado.
- Linguagem acolhedora e neutra, sem culpa, rankings ou celebração automática de perda de peso.

## 4. Navegação e responsividade

| Rota | Seção |
| --- | --- |
| /hoje | Painel diário |
| /corpo | Peso e medidas |
| /pressao | Pressão arterial |
| /rotina | Medicamentos, vitaminas e suplementos |
| /configuracoes | Perfil, lembretes e preferências |
| /entrar | Login |
| /criar-conta | Cadastro |

Celular: navegação inferior com Hoje, Corpo, Pressão e Rotina; cartões empilhados. Desktop: menu lateral com logo e conteúdo em duas ou três colunas. Suportar 320 px sem rolagem horizontal. Reservar espaço para a barra inferior e safe areas.

Ação global **Registrar** abre peso, medidas, pressão e tomada de medicamento/vitamina. Usar bottom sheet no celular e modal no desktop, ou tela dedicada para formulários longos.

## 5. Funcionalidades

### 5.1 Conta e preferências

- Cadastro, login, logout e recuperação de acesso por e-mail.
- Usar biblioteca/provedor consolidado; não implementar criptografia própria.
- Sessão segura em cookie HttpOnly, Secure em produção e SameSite apropriado.
- Nome de exibição, fuso IANA, módulos visíveis e preferências de lembrete.
- Locale pt-BR; unidades kg, cm, mmHg e bpm.
- Cada conta acessa somente os próprios registros.
- Ambiente demo e seed devem conter apenas dados fictícios.

### 5.2 Hoje

- Saudação, data local e atalhos.
- Último peso com data e minigráfico.
- Última pressão com data e horário.
- Última sessão de medidas e valores disponíveis.
- Lista “Seu cuidado hoje” com ocorrências ordenadas por horário.
- Ações “Marcar como tomado” e “Registrar pressão”.
- Identificar registros antigos e nunca apresentá-los como medições de hoje.
- Estados vazios contextuais; atualizar resumo após alterações.

### 5.3 Corpo — peso

- Criar, editar e excluir peso, data, horário e observação opcional.
- Permitir mais de um registro por dia.
- Meta opcional, editável e removível, sem recomendação automática.
- Variação = peso atual menos o registro cronologicamente anterior.
- Histórico decrescente e gráfico de 7, 30, 90 dias e todo o período.
- Não preencher dias sem medição com zero; com um registro, mostrar um ponto.
- Gráfico usa todos os registros do período, independentemente da página do histórico.

### 5.4 Corpo — medidas

- Sessão com data, horário, observação e pelo menos uma medida.
- Tipos: cintura, abdômen, quadril, peito, braço e coxa, em cm.
- Braço e coxa podem ter lado esquerdo, direito ou não especificado.
- Demais tipos usam lado não especificado.
- Campos não preenchidos ficam ausentes, nunca zero.
- Selecionar tipo e lado para gráfico e comparação com registro anterior equivalente.
- Editar e excluir sessão. Não comparar cintura com abdômen ou lados diferentes.

### 5.5 Pressão

- Sistólica e diastólica obrigatórias, pulso opcional, data, horário e observação.
- Permitir várias medições diárias, edição e exclusão.
- Gráfico com duas linhas, legenda, valores e filtros de período.
- Pulso aparece separado, sem misturar bpm e mmHg no mesmo eixo.
- Não gerar diagnósticos ou classificações clínicas.
- Nota: “Seus registros ajudam no acompanhamento com um profissional de saúde.”

### 5.6 Rotina

Abas **Hoje**, com seletor de data, e **Meus itens**, com ativos e arquivados.

Cadastro de item:
- Nome e tipo: medicamento, vitamina ou suplemento.
- Quantidade da dose, unidade e instruções pessoais opcionais.
- Início, término opcional e fuso da programação.
- Frequência diária, dias específicos da semana ou sem programação.
- Um ou mais horários fixos para frequências programadas.
- Lembrete ativado/desativado.

Horários fixos não equivalem a intervalos “a cada N horas”; esses intervalos ficam fora desta versão.

Estados de uma ocorrência:

| Estado | Regra |
| --- | --- |
| Programado | Horário futuro sem decisão |
| Não registrado | Horário alcançado/passado sem decisão |
| Tomado | Confirmação explícita com horário real |
| Não tomado | Decisão explícita do usuário |

- Confirmar tomada preenche horário real como agora, editável.
- Permitir tomada passada, nunca instante real futuro.
- Permitir desfazer, editar horário e adicionar observação.
- Tomada avulsa exige item cadastrado e não confirma automaticamente uma ocorrência.
- Ausência de registro nunca significa automaticamente “Não tomado”.
- Arquivar interrompe futuro e preserva histórico.
- Histórico mantém snapshot de nome, dose e unidade, mesmo após edição do cadastro.
- Repetir requisição ou clicar duas vezes não duplica registros.

## 6. Regras temporais e validação

- Validar cliente e servidor; servidor é a autoridade.
- Aceitar vírgula decimal na interface, normalizar no contrato da API.
- Peso e medidas positivos, até duas casas; dose positiva, até três casas e unidade obrigatória.
- Pressão e pulso inteiros positivos. Pulso vazio é null.
- Não inventar limites clínicos como bloqueios.
- Se diastólica >= sistólica, pedir conferência, permitindo confirmação consciente sem diagnóstico.
- Nome obrigatório após trim, até 120 caracteres; observações até 1000.
- Datas de medições/tomadas não podem ser futuras. Programações podem começar no futuro.
- Término inclusivo e nunca anterior ao início.
- Horários únicos; frequência semanal exige ao menos um dia.
- Salvar instantes UTC e fuso IANA; datas da programação permanecem datas locais.
- “Hoje” usa fuso do perfil; ocorrências são geradas no fuso da programação.
- Alterar fuso do perfil não modifica silenciosamente programações existentes.
- Horário de verão: horário inexistente avança ao primeiro instante válido; repetido gera uma ocorrência no primeiro instante.
- Período de N dias inclui hoje e N−1 dias anteriores no fuso local.

### Versionamento de programação

- Alteração de horários, frequência, dose ou fuso cria versão com vigência a partir da confirmação.
- Cancelar apenas ocorrências futuras pendentes da versão anterior e gerar novas.
- Não alterar passado nem decisões já registradas.
- Arquivar cancela apenas futuro pendente.
- Gerar ocorrências idempotentemente e em transação quando houver múltiplos documentos.
- Não usar timestamp de edição como substituto da data da medição.

## 7. Modelo MongoDB

Coleções de domínio têm `_id` UUID string, `userId`, `createdAt`, `updatedAt` e `version` quando editáveis. Datas instantâneas usam BSON Date. Quantidades decimais usam Decimal128 no adapter e strings decimais canônicas nos contratos; não expor BSON ao domínio.

| Coleção | Campos específicos |
| --- | --- |
| users | emailNormalized, dados de autenticação conforme solução escolhida |
| profiles | displayName, timezone, visibleModules, remindersEnabled, offlineEnabled |
| weightEntries | measuredAt, timezone, weightKg, notes, deletedAt |
| weightGoals | targetKg, active |
| measurementSessions | measuredAt, timezone, notes, values: [{type, side, valueCm}], deletedAt |
| bloodPressureEntries | measuredAt, timezone, systolic, diastolic, pulseBpm, notes, deletedAt |
| routineItems | name, type, currentDose, currentUnit, instructions, archivedAt |
| scheduleVersions | itemId, frequency, weekdays, times, timezone, startDate, endDate, effectiveFrom, effectiveUntil, doseSnapshot, reminderEnabled |
| occurrences | itemId, scheduleVersionId, scheduledAt, localDate, localTime, nameSnapshot, doseSnapshot, unitSnapshot, cancelledAt |
| intakeRecords | itemId, occurrenceId opcional, status, actualTakenAt, notes, nameSnapshot, doseSnapshot, unitSnapshot, deletedAt |
| idempotencyKeys | userId, operationId, requestHash, responseStatus, responseBody |
| pushSubscriptions | userId, deviceId, endpoint, keys |
| notificationJobs | occurrenceId, subscriptionId, dueAt, status, attempts, leaseUntil |

Medidas ficam embutidas por sessão porque formam um conjunto pequeno atualizado em conjunto. Validação de unicidade type + side ocorre no agregado.

Índices obrigatórios:
- users.emailNormalized único.
- profiles.userId único.
- Históricos: userId + measuredAt + _id.
- Uma meta ativa por usuário, com índice parcial único.
- occurrences: scheduleVersionId + localDate + localTime único; userId + scheduledAt para consulta.
- intakeRecords: índice parcial único para occurrenceId string em registros ativos; avulsos omitem esse campo.
- idempotencyKeys: userId + operationId único.
- notificationJobs: occurrenceId + subscriptionId único.
- pushSubscriptions: endpoint único e userId + deviceId para gerenciamento.

Todas as buscas e mutações incluem userId autorizado. MongoDB não oferece integridade referencial automática: validar relações no caso de uso. Atualizar com filtro por versão e incrementar version atomicamente. Conflitos retornam 409.

Usar replica set inclusive no desenvolvimento para transações. Fornecer scripts idempotentes de índices e migrações. Exclusões sincronizáveis preservam tombstones; na primeira versão não removê-los automaticamente. Não expirar chaves de idempotência enquanto operações antigas puderem ser reenviadas.

## 8. API

Prefixo `/api/v1`. Documentar schemas, paginação e erros em OpenAPI.

| Recurso | Operações |
| --- | --- |
| /profile | GET, PATCH |
| /dashboard?date= | GET |
| /weights | GET, POST; PATCH/DELETE /:id |
| /weight-goal | GET, PUT, DELETE |
| /measurements | GET, POST; PATCH/DELETE /:id |
| /blood-pressure | GET, POST; PATCH/DELETE /:id |
| /routine-items | GET, POST; PATCH /:id |
| /routine-items/:id/archive | POST |
| /routine-items/:id/schedules | POST |
| /occurrences?date= | GET |
| /occurrences/:id/intake | PUT, DELETE para desfazer |
| /intakes | GET, POST avulso; PATCH/DELETE /:id |
| /sync/bootstrap | GET snapshot consistente e cursor |
| /sync/changes?cursor= | GET alterações e tombstones |
| /sync/operations | POST lote de operações offline |
| /push-subscriptions | POST; DELETE /:id |

- Identidade vem da sessão; ignorar userId fornecido no payload.
- Históricos paginados por cursor estável, com intervalo máximo documentado.
- Mutação aceita operationId único e expectedVersion em edição/exclusão.
- Mesma operationId e payload retornam o resultado anterior; payload diferente retorna conflito.
- Operação e resposta idempotente devem ser confirmadas atomicamente.
- Erros: code, message, fieldErrors e correlationId, sem dados sensíveis.
- Endpoint de sincronização chama os mesmos casos de uso dos endpoints comuns.

## 9. PWA — requisito obrigatório

### Instalação

- Manifest com id, name “Zelo”, short_name, lang pt-BR, start_url, scope, display standalone, theme_color e background_color.
- Ícones locais 192 e 512 px, incluindo variante maskable, derivados da marca sem distorção.
- Apple touch icon e metadados apropriados.
- Service worker registrado em produção e servido em HTTPS, exceto desenvolvimento local.
- CTA “Instalar Zelo” somente quando disponível; instruções alternativas de instalação conforme plataforma.
- A aplicação continua utilizável no navegador, sem instalação.
- Usar detecção de capacidades, não presumir suporte uniforme entre navegadores.

### Cache e dados offline

- Precache apenas do app shell e assets versionados.
- Não colocar respostas autenticadas ou dados de saúde em Cache Storage genérico.
- IndexedDB é cache de trabalho e fila local; MongoDB é a fonte persistente sincronizada.
- Disponibilidade offline de dados pessoais é habilitada pelo usuário por dispositivo, com explicação curta de que ficam nesse dispositivo.
- Sem habilitação: app shell offline exibe estado de conexão, sem histórico pessoal.
- Com habilitação e sessão previamente autenticada: consultar dados já baixados, registrar peso, medidas, pressão e tomada; editar/excluir medições locais.
- Cadastro/edição de programações, conta e configuração de push exigem conexão nesta versão.
- Mostrar “Offline”, “Última sincronização” e contagem de operações pendentes.
- Estado “Salvo neste dispositivo” não equivale a “Sincronizado”.
- Login inicial e recuperação de conta exigem internet.

### Fila e sincronização

Cada operação local contém operationId UUID, ownerUserId, entityId UUID, tipo, payload, expectedVersion, createdAt e estado pending/syncing/synced/conflict/error.

1. Persistir alteração local e operação na mesma transação IndexedDB.
2. Sincronizar ao abrir o app, reconectar e acionar “Sincronizar agora”.
3. Background Sync é otimização opcional; o fluxo deve funcionar sem ele.
4. Processar em ordem por entidade, preservando dependências entre criar, editar e excluir.
5. Servidor valida sessão, propriedade, versão e idempotência.
6. Confirmar localmente somente depois da resposta do servidor.
7. Buscar alterações remotas e tombstones usando cursor opaco estável, sem depender do relógio do cliente.
8. Servidor deve garantir que snapshot inicial e cursor não percam alterações concorrentes; usar sequência transacional por usuário ou mecanismo equivalente documentado.
9. Repetir falhas transitórias com backoff. 401 pausa fila e solicita login. 409 abre resolução de conflito. Erros de validação ficam visíveis para correção.
10. Nunca usar last-write-wins silencioso em dados de saúde. Mostrar versão local e remota; usuário pode manter a remota ou reaplicar edição com a versão atual.

- Não sincronizar fila de uma conta autenticada como outra.
- Mudança de conta deve limpar dados locais da anterior.
- Logout com pendências oferece sincronizar, cancelar logout ou descartar explicitamente; nunca descartar silenciosamente.
- Logout limpa IndexedDB pessoal, memória e subscriptions daquele dispositivo; se offline, limpar localmente e efetuar revogação ao reconectar antes de permitir nova sessão online.
- Service worker não armazena tokens de sessão em localStorage ou IndexedDB.
- Não prometer criptografia de dados locais sem implementação real.

### Atualização do aplicativo

- Detectar service worker em espera e mostrar “Nova versão disponível”.
- Aplicar atualização após ação do usuário, preservando rascunhos e fila.
- Versionar schema IndexedDB com migrações não destrutivas.
- Não forçar reload durante edição ou sincronização.
- Remover caches estáticos antigos após ativação segura.

### Lembretes e Web Push

- Lembretes dentro do app funcionam independentemente da permissão de push.
- Implementar Web Push quando suportado, com consentimento solicitado após ação explícita.
- Salvar subscriptions por usuário e dispositivo; permitir desativar.
- Scheduler/worker no backend agenda notificações a partir das ocorrências, com lease e deduplicação para múltiplas instâncias.
- Cancelar jobs ao arquivar, alterar programação ou registrar decisão, revalidando estado antes de enviar.
- Remover subscriptions inválidas e limitar retentativas.
- Texto padrão genérico na tela bloqueada: “Você tem um cuidado programado no Zelo”. Não expor medicamento, dose ou medida.
- Clique abre a rotina; não confirma tomada automaticamente.
- Push é melhor esforço, depende de navegador, sistema e conexão; não prometer entrega exata ou alarmes offline com app fechado.
- Em plataformas sem suporte ou com permissão negada, manter agenda e lembretes internos.

## 10. Estados, acessibilidade e segurança

- Carregamento, vazio, erro, sucesso, validação, offline, conflito e sessão expirada são estados distintos.
- Preservar campos após falha; impedir submissão duplicada.
- Confirmar exclusões e oferecer desfazer quando aplicável.
- Labels associados, foco visível, navegação por teclado, foco contido em modal e retorno ao gatilho.
- Alvos de toque de pelo menos 44 px; respeitar redução de movimento.
- Gráficos acompanhados de valores em lista/tabela acessível.
- Autorização em todas as consultas, mutações, sync e subscriptions.
- Rate limit em autenticação, push e endpoints de escrita; proteção CSRF compatível com cookies.
- Não registrar dados de saúde, tokens ou senhas em logs.
- Cache privado segregado por conta; sem analytics de conteúdo sensível.
- Segredos por ambiente e .env.example sem credenciais.

## 11. Critérios de aceite e testes

- [ ] Cadastro/login/logout e recuperação funcionam.
- [ ] Dados persistem após reload e novo login.
- [ ] Conta A não acessa IDs, sync ou subscriptions de B.
- [ ] Peso aceita 82,35 kg e preserva precisão.
- [ ] Sessão com apenas cintura é válida; ausências não viram zero.
- [ ] Pressão aceita pulso vazio.
- [ ] Gráficos e variações respeitam ordem temporal e tipo/lado.
- [ ] Rotina diária, semanal, término inclusivo e arquivamento funcionam.
- [ ] Ausência de tomada nunca se converte automaticamente em Não tomado.
- [ ] Editar dose/programação preserva histórico.
- [ ] Reenvio de operação não duplica medição ou tomada.
- [ ] PWA instala onde suportado e abre em modo standalone.
- [ ] Após habilitar offline e carregar dados, aplicativo abre sem rede.
- [ ] Criar medição offline, fechar/reabrir e reconectar preserva e sincroniza uma única vez.
- [ ] Conflito entre dois dispositivos é exibido, sem sobrescrita silenciosa.
- [ ] Exclusão remota remove cache local via tombstone.
- [ ] Logout/troca de conta não expõe dados anteriores nem perde fila sem aviso.
- [ ] Atualização do service worker preserva rascunhos e pendências.
- [ ] Fluxos funcionam sem Background Sync e sem permissão push.
- [ ] Push usa mensagem genérica e respeita desativação.
- [ ] Layout funciona em 320, 390, 768 e 1440 px sem conteúdo coberto.
- [ ] Não existem telas ou campos de refeições/dieta.

Testes prioritários:
- Unitários de domínio: medidas, datas, transições de tomada e programação.
- Aplicação com ports fake: Clock, repositories e notificações.
- Integração com MongoDB replica set: índices, transações, isolamento, idempotência e concorrência.
- E2E: registrar/editar/excluir; confirmar/desfazer tomada; offline/reconexão; conflitos e logout.
- Teste de fronteiras arquiteturais impedindo domínio/aplicação de importar adapters.
- Executar lint, typecheck, testes relevantes e build; validar PWA em build de produção, não só no dev server.

## 12. Ordem de execução e entregáveis

1. Monorepo com duas aplicações independentes: frontend Next.js e backend Node.js/Fastify; arquitetura hexagonal no backend, contratos e tokens visuais.
2. Autenticação, MongoDB, índices, autorização e perfil.
3. Peso, medidas e pressão com históricos e gráficos.
4. Rotina, programação versionada e registros de tomada.
5. Dashboard e preferências.
6. Manifest, service worker e instalação.
7. IndexedDB, fila, sincronização e conflitos.
8. Push, jobs e fallback de lembretes internos.
9. Verificação responsiva, acessibilidade, testes e documentação.

Entregar frontend Next.js e backend Node.js executáveis separadamente, Dockerfiles próprios, Docker Compose, scripts de índices/migração, seed fictício opcional, .env.example, OpenAPI e README. Documentar como executar API, web e worker, configurar replica set e VAPID, testar offline e instalar PWA. Registrar decisões e limitações reais. Não apresentar notificações, persistência ou sincronização simuladas como funcionalidades prontas.
