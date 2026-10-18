# Zelo — Incremento: água, passos e exercícios

Especificação fornecida pelo proprietário em 18/10/2026. Complementa `spec.md`; onde houver conflito, este documento prevalece para água/atividade (ex.: água e calorias ativas de exercícios passam a ser permitidas; refeições e dieta continuam proibidas).

Edite o código existente do **Zelo** para adicionar **registro de água e acompanhamento de passos e exercícios**, preservando as funcionalidades atuais.

Implemente as alterações no código, incluindo backend, frontend, persistência e testes. Não se limite a apresentar um plano.

## 1. Contexto técnico

O projeto utiliza:
- Frontend React/Next.js com TypeScript.
- Backend Node.js com TypeScript, separado do frontend.
- MongoDB.
- Arquitetura hexagonal no backend.
- PWA.

Leia as instruções do repositório e reutilize seus padrões de autenticação, componentes, persistência, testes e funcionamento offline.

Preserve peso, medidas corporais, pressão arterial, medicamentos, vitaminas e suplementos. Não adicionar refeições ou dieta.

## 2. Integração com o iPhone: somente recebimento

O fluxo é exclusivamente:

**iPhone/Auto Export → POST REST autenticado → backend Zelo → MongoDB.**

Toda a configuração, periodicidade e execução dos envios acontece no Auto Export.

O Zelo deve:
1. Receber a requisição autenticada.
2. Validar e interpretar os dados.
3. Salvar ou atualizar os registros.
4. Disponibilizá-los para consulta nas telas.

Não implementar para essa integração:
- Busca de dados no iPhone ou Apple Saúde.
- Agendadores, polling, workers ou tarefas de sincronização.
- Filas de importação no frontend.
- Sincronização bidirecional.
- WebSockets ou notificações push.
- Telas de configuração ou gerenciamento da integração.
- Botões para sincronizar, importar ou testar conexão.

Processe o recebimento na própria requisição HTTP. O frontend consulta os dados armazenados ao abrir as telas, seguindo o padrão existente.

Essas restrições se aplicam à integração de atividade. Preserve os mecanismos existentes de PWA, registros offline e lembretes das outras funcionalidades.

## 3. Arquitetura

Respeite a arquitetura hexagonal:
- Domínio: entidades, objetos de valor e invariantes.
- Aplicação: casos de uso e portas.
- Adapters de entrada: controllers HTTP e interpretação do payload externo.
- Adapters de saída: persistência MongoDB.
- Composition root: instanciação e injeção de dependências.

Domínio e aplicação não devem importar MongoDB, framework HTTP ou componentes React.

Organize as funcionalidades em módulos de hidratação e atividade, conforme o projeto.

Casos de uso sugeridos: RegisterWaterIntake, UpdateWaterIntake, DeleteWaterIntake, GetHydrationSummary, SetHydrationGoal, ReceiveHealthExport, GetDailySteps, SetStepsGoal, ListWorkouts, GetWorkoutDetails.

Não implemente persistência ou regras de negócio em Route Handlers, API Routes ou Server Actions do Next.js.

## 4. Água

Implementar:
- Registro manual de quantidade em ml, data e horário.
- Botões rápidos de 200, 300 e 500 ml.
- Quantidade personalizada.
- Edição e exclusão.
- Total diário.
- Meta diária opcional.
- Histórico e gráfico de 7 e 30 dias.

Regras:
- Quantidade inteira positiva.
- Horário inicialmente preenchido com o momento atual.
- Permitir registros retroativos, mas não futuros.
- Agrupar pelo fuso do usuário.
- Meta definida pelo usuário, sem recomendação automática.
- Mostrar volume real mesmo acima da meta.
- Botões rápidos salvam diretamente e oferecem desfazer.
- Distinguir ausência de registros de consumo comprovadamente zero.

Reutilize a infraestrutura offline existente para registrar, editar, excluir e sincronizar água, sem duplicações. Não criar uma segunda fila ou estratégia de sincronização.

## 5. Contrato do Auto Export

Referências oficiais:
- REST API: https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/
- Envelope JSON: https://help.healthyapps.dev/en/health-auto-export/export-format/
- Métricas: https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics/
- Exercícios: https://help.healthyapps.dev/en/health-auto-export/export-format/workouts/

O contrato deste incremento será:
- JSON.
- Exercícios no formato versão 2.
- Passos consolidados por dia.
- Uma fonte de totais diários consolidada por usuário.
- Recebimento de métricas e exercícios em requisições independentes ou no mesmo envelope.

Documente no README a configuração esperada no Auto Export:
- Automação de passos: Health Metrics, Step Count, resumo ativado e agrupamento diário.
- Automação de exercícios: Workouts, versão 2.
- Ambas enviam para o mesmo endpoint.
- Usar período Default para passos, incluindo dia anterior e dia atual.
- Não usar intervalos “Since Last Sync” como se fossem totais completos do dia.
- Rotas GPS desativadas para este escopo.
- Header de autenticação configurado no próprio Auto Export.

Não criar uma interface para essas configurações no Zelo.

### Payload de passos (exemplo fictício)

```json
{
  "data": {
    "metrics": [
      {
        "name": "step_count",
        "units": "count",
        "data": [
          { "date": "2026-10-18 00:00:00 -0300", "qty": 6842 }
        ]
      }
    ]
  }
}
```

### Payload de exercício v2

```json
{
  "data": {
    "workouts": [
      {
        "id": "706e08a9-66a1-4820-83dd-f7c6e314ff66",
        "name": "Running",
        "start": "2026-10-18 07:00:00 -0300",
        "end": "2026-10-18 07:30:00 -0300",
        "duration": 1800,
        "distance": { "qty": 4.2, "units": "km" },
        "activeEnergyBurned": { "qty": 310, "units": "kcal" }
      }
    ]
  }
}
```

Campos obrigatórios do exercício: id, name, start, end, duration (segundos). Distância e energia ativa são opcionais. Não confundir activeEnergyBurned com totalEnergy.

Aceite campos adicionais documentados, mas persista apenas os necessários ao escopo. Não salve rotas ou outros dados sensíveis desnecessários.

## 6. Endpoint e autenticação

```http
POST /api/v1/imports/health
Authorization: Bearer <token>
Content-Type: application/json
```

- Reutilize a autenticação de integração existente. Se não existir, implemente token aleatório opaco associado ao usuário.
- Armazene apenas o hash do token.
- Disponibilize geração e revogação por script administrativo, sem tela.
- Identifique o usuário pela credencial, nunca por userId enviado no JSON.
- Não exponha tokens no frontend ou em logs.
- Valide o tamanho máximo do corpo e documente o limite.
- Não registre o payload completo em logs.

O Auto Export também pode enviar headers como automation-id, automation-name, automation-aggregation, automation-period, session-id. Trate-os como metadados, não como autenticação. Não use session-id para deduplicar registros. Valide o agrupamento quando houver informação confiável no header. Não invente os valores literais enviados nesses headers; confira um envio real ou a documentação.

### Respostas

- 200: processamento concluído.
- 400: estrutura ou campos inválidos.
- 401: credencial ausente, inválida ou revogada.
- 413: corpo acima do limite.
- 422: formato válido, mas incompatível com o contrato de totais diários.
- 500: falha inesperada de persistência.

```json
{
  "status": "ok",
  "steps": { "inserted": 1, "updated": 0, "unchanged": 0 },
  "workouts": { "inserted": 0, "updated": 1, "unchanged": 0 }
}
```

Os contadores devem refletir o resultado real. Não simular sucesso. Valide todo o lote antes de gravar. Se houver falha de banco após gravações parciais, responda com erro; reenvios devem ser seguros graças aos upserts e índices únicos.

## 7. Parser e normalização

Formato de data documentado: `yyyy-MM-dd HH:mm:ss Z` (ex.: `2026-10-18 07:00:00 -0300`). Use parsing explícito preservando o offset (ex.: Luxon `DateTime.fromFormat(value, "yyyy-MM-dd HH:mm:ss ZZZ", { setZone: true })`). Não dependa de `new Date(string)`.

Normalização:
- Passos: inteiro não negativo.
- Duração: segundos, número finito não negativo.
- Distância: converter km ou mi para metros.
- Energia ativa: converter unidades suportadas para kcal.
- Métricas ausentes permanecem null ou ausentes.
- Fim do exercício não pode preceder início.
- Não substituir a duração enviada pela diferença entre início e fim.
- Converta somente unidades explicitamente suportadas; desconhecidas → erro claro.

Passos:
- Aceitar apenas step_count com unidade count nesta versão.
- Exigir um ponto consolidado por dia no lote; não somar pontos repetidos do mesmo dia.
- Rejeitar lotes ambíguos que aparentem conter dados por fonte ou intervalos.
- Não inferir que qualquer ponto é diário apenas pelo timestamp.

## 8. Persistência e deduplicação

Coleções sugeridas: waterEntries, hydrationGoals, dailySteps, activityGoals, workouts, integrationCredentials.

Passos: índice único `{ userId, provider, localDate }`; upsert com `$set` (nunca `$inc`); 6.842 → 7.100 resulta em 7.100; correções para menor permitidas; não somar com exercícios nem incorporar stepCount de workouts; não excluir dias ausentes; usar a data local fornecida na exportação.

Exercícios: índice único `{ userId, provider, externalId }`; externalId = id exportado; reenvio atualiza; calorias/distância não fazem parte da identidade; não apagar ausentes. Separar horário do evento e horário de recebimento. Sem versão confiável da origem → política “último recebimento substitui” (documentar). Tratar concorrência nos upserts (sem duplicatas nem erros de chave única não tratados).

## 9. Interface

Passos: total diário, meta opcional editável, progresso, histórico, gráfico de 7 e 30 dias, média só dos dias com dados, último recebimento. Distinguir dia sem dados, dia com zero informado e dia atual parcial. Sem edição manual.

Exercícios: lista agrupada por data, filtros por período e modalidade, modalidade/início/duração, distância e calorias ativas quando houver, tela de detalhes, origem e data do recebimento. Somente leitura. Sem mapas, rotas ou frequência cardíaca.

## 10. Navegação e visual

Navegação: Hoje, Corpo, Saúde, Atividade, Rotina. Saúde: abas Pressão e Água (preservar links de /pressao). Atividade: abas Resumo, Passos, Exercícios.

Hoje: passos do dia, tempo total de exercícios, água consumida, meta de água opcional, atalho “Registrar água”, último recebimento dos dados de atividade.

Identidade visual mantida (#FF8243, #FFC0CB, #FCE883, #069494, fundo claro, cartões arredondados). pt-BR, vírgula decimal, unidades explícitas, responsivo.

Estado vazio: “Nenhum dado de atividade recebido ainda.” / “Seus passos e exercícios aparecerão aqui após o recebimento dos dados do Auto Export.”

Sem configuração da integração, botões de importação ou controles de sincronização com o iPhone.

## 11. PWA

Preservar instalação, SW e offline. Água usa o mecanismo de operações offline existente. Passos e exercícios consultáveis offline quando já armazenados; mostrar a data dos dados. Nada de importação/comunicação com iPhone no SW. Preservar pendências ao atualizar. Isolamento entre contas e limpeza no logout.

## 12. Testes

Água (criar, editar, excluir, desfazer, total, meta); água offline com reconexão sem duplicação; datas perto da meia-noite; parsing com offset; payload só metrics / só workouts / ambos; arrays vazios; opcionais ausentes; credencial inválida ou revogada; isolamento entre usuários; reenvio do mesmo payload; passos maior e menor; rejeição de passos ambíguos; atualização de exercício pelo id; km e mi; concorrência sem duplicatas; falha de banco seguida de reenvio; preservação das funcionalidades anteriores. Executar lint, typecheck, testes e build.
