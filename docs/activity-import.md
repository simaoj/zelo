# Recebimento de atividade (Health Auto Export → Zelo)

Contrato do endpoint `POST /api/v1/imports/health`. Implementação: `apps/api/src/modules/activity`
(parser em `adapters/in/http/health-export/health-export-parser.ts`, caso de uso `ReceiveHealthExport`)
e credenciais em `apps/api/src/modules/integrations`. Configuração do app e comandos de token: README,
seção “Atividade”.

Fontes (documentação oficial do Health Auto Export, consultada em 18/10/2026):
[REST API](https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/) ·
[Envelope](https://help.healthyapps.dev/en/health-auto-export/export-format/) ·
[Métricas](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics/) ·
[Exercícios](https://help.healthyapps.dev/en/health-auto-export/export-format/workouts/).

## Fluxo

Somente recebimento, processado dentro da própria requisição HTTP: autentica → valida o lote inteiro →
grava numa transação → responde com contadores reais. Não há polling, filas, jobs, WebSockets ou
comunicação com o iPhone partindo do Zelo.

## Autenticação

- `Authorization: Bearer zelo_hae_<43 caracteres base64url>` (32 bytes aleatórios). Guardamos só
  `sha256(token)` (coleção `integrationCredentials`, índice único `tokenHash`); a busca é pelo hash e a
  comparação final é em tempo constante. `lastUsedAt` é atualizado a cada uso; `revokedAt` desativa.
- A rota declara `config.integrationAuth`: o hook de sessão não roda (cookie ignorado) e o CSRF não se
  aplica (não há credencial ambiente do navegador). A autenticação acontece em `onRequest`, antes de ler o
  corpo — 401 tem precedência sobre 413/415/400.
- O usuário é sempre o dono da credencial. Campos `userId` no JSON são ignorados.
- O redaction do pino já cobre `req.headers.authorization`; o serializer de requisição registra só método e
  caminho. O log de sucesso contém `userId`, contadores, nomes de métricas ignoradas e os headers
  `automation-*`/`session-id` (truncados) — nunca o corpo.

## Headers do Auto Export

A documentação lista `automation-name`, `automation-id`, `automation-aggregation` (“The selected time
grouping”), `automation-period` (“The selected date range”) e `session-id` (“Unique identifier for each
request”), **sem publicar os valores literais**. Por isso:

- nenhum deles autentica, deduplica ou altera o processamento;
- `automation-aggregation` **não é validado** (não inventamos valores como “days”); a garantia de “total
  diário” vem da forma dos dados (abaixo);
- todos vão para o log apenas como metadados.

## Envelope e limites

- `Content-Type: application/json` (outro tipo → 415); corpo ≤ 5 MB (`HEALTH_IMPORT_MAX_BYTES`, via
  `bodyLimit` da rota; acima → 413 no formato `ApiError`).
- `{"data": {"metrics"?: [...], "workouts"?: [...]}}`. Só métricas, só exercícios, ambos, arrays vazios ou
  `data: {}` são válidos. Outros arrays documentados (`stateOfMind`, `medications`, …) são ignorados.
- Datas: `yyyy-MM-dd HH:mm:ss Z` (ex.: `2026-10-18 07:00:00 -0300`), lidas com
  `DateTime.fromFormat(v, "yyyy-MM-dd HH:mm:ss ZZZ", { setZone: true })` após checagem por regex — nunca
  `new Date(string)`. O instante é guardado em UTC e o **offset e a data local vêm do próprio texto**.

## Passos (`step_count`)

- Aceito apenas `name: "step_count"` com `units: "count"` (outra unidade → 400). Métricas com outros nomes
  são **ignoradas** (não gravadas; aparecem como `ignoredMetrics` no log) para não descartar os passos de um
  envio que inclua mais métricas.
- Cada ponto: `date` + `qty` inteiro ≥ 0 (decimal, negativo ou não numérico → 400). `0` é um zero informado.
  `source` é metadado documentado (“when available”) e não é gravado.
- Totais diários consolidados (→ 422 se violado, nada é gravado):
  - a mesma data local aparece mais de uma vez no lote (dados por fonte ou por intervalo) — nunca somamos;
  - pontos com forma de intervalo (`startDate`/`endDate`).
  O Zelo **não** infere que um ponto é diário pelo horário (a documentação não define o timestamp de
  pontos resumidos); um único ponto por dia é aceito como o total daquele dia, por isso a configuração
  exigida é *Summarize Data* ligado com agrupamento diário e período *Default*.
- Persistência: `dailySteps`, índice único `{userId, provider, localDate}`; upsert com
  `$set {count, offsetMinutes, receivedAt}` e `$setOnInsert {_id (UUID), createdAt}`. 6.842 → 7.100 → 5.000
  resulta em 5.000. Passos de exercícios nunca entram no total diário. Dias ausentes não são apagados.

## Exercícios (versão 2)

- Obrigatórios: `id` (texto), `name`, `start`, `end`, `duration` (segundos, número finito ≥ 0).
  `end < start` (comparado como instantes) → 400. A duração é gravada **como enviada** (não recalculada).
- `distance {qty, units}`: `km` ×1000, `mi` ×1609,344, `m` ×1 → metros; outra unidade → 400.
- `activeEnergyBurned {qty, units}`: `kcal` ou `kJ` (÷ 4,184) → kcal; outra → 400. **`totalEnergy` é
  ignorado** (inclui gasto em repouso). Ausentes → `null`.
- Rota GPS, frequência cardíaca, velocidade, elevação, clima, `metadata` etc. são ignorados e não gravados.
- Mesmo `id` repetido no lote: idêntico → mantido uma vez; diferente → 422.
- Persistência: `workouts`, índice único `{userId, provider, externalId}` (`externalId` = `id` exportado) e
  índice `{userId, startedAt, _id}` para a lista. Calorias/distância não fazem parte da identidade.

## Deduplicação e “último recebimento substitui”

A origem não fornece versão confiável dos registros, então o último lote recebido substitui os valores do
mesmo dia/exercício. Contadores:

- `inserted` — não existia; `updated` — algum valor mudou; `unchanged` — todos os valores iguais.
- `receivedAt` significa “último recebimento”: é atualizado também quando o registro fica `unchanged`
  (mostra que a integração continua chegando), mas **sem** gerar linha no change log de sync.
- `inserted`/`updated` gravam `changes` (`dailySteps` / `workout`, op `upsert`) na mesma transação, então
  dispositivos com modo offline recebem os dados por `/sync/changes`. Não há operações offline para
  atividade (somente leitura). Bootstrap inclui os últimos 90 dias e a meta (`activityGoal`, id = userId).

## Concorrência e falhas

- O lote inteiro roda em **uma transação** (`UnitOfWork`). Envios simultâneos do mesmo usuário conflitam no
  contador de sync e são repetidos pelo driver; se ainda assim um upsert concorrente gerar chave duplicada
  (11000), o lote inteiro é reexecutado uma vez — nunca 500 por isso, nunca duplicatas (índices únicos).
- Falha de banco no meio do lote → transação abortada, nada gravado, resposta 500 `INTERNAL_ERROR`.
  Reenviar o mesmo payload é seguro.

## Limitações

- Um provedor (`health-auto-export`) e uma fonte consolidada de totais diários por usuário.
- Se o Auto Export for configurado com “Since Last Sync” ou sem resumo diário mas com um único ponto por
  dia, o valor parcial será gravado como total do dia — não há como distinguir pelos dados.
- O celular precisa alcançar a API (IP da LAN ou HTTPS público); o Zelo não oferece túnel/relay.
- Tokens não expiram; revogue pelo script. Não há tela para gerenciá-los.
