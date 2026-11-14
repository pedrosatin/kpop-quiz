# ADR 033 sobre a espera por `maxlag` e a versão das regras de evidência

## Status

Aprovado em 2026-11-13. Muda o tratamento de `maxlag` em `kpop_scraping/mediawiki.py`, acrescenta a migração 11 (`fact_runs.evidence_rules_version`) e acrescenta `evidence_rules` ao resultado de `run_daily_puzzles`. O workflow `daily-puzzles-cron.yml`, os limites de tentativa do [ADR 032](032-rebuild-com-fallback-em-passo-separado.md) e o parâmetro `maxlag=5` continuam como estavam.

## Contexto

Toda requisição à Action API da Wikipedia e do Wikidata envia `maxlag=5`, como pede a etiqueta da API para robôs e a regra do projeto. Quando o atraso das réplicas, ou do serviço de consulta no caso do Wikidata, passa de 5 segundos, a API responde com o erro `maxlag`, um cabeçalho `Retry-After` e o atraso medido.

O cliente tratava esse erro como uma falha de rede: até 3 novas tentativas, com espera de 1, 2 e 4 segundos ou o `Retry-After`. Em novembro de 2026, o atraso do Wikidata ficou entre 9 e 14 segundos por horas na maioria das noites. Cada tentativa do rebuild desistia em menos de um minuto, as 3 tentativas do ADR 032 terminavam em cerca de 20 minutos e o dia saía do banco em cache. Isso aconteceu em 8 das 10 execuções agendadas anteriores a 2026-11-13. Um rebuild que encontra o Wikidata em dia leva cerca de 2 minutos.

Nenhuma tabela guardava a versão das regras de evidência (`EVIDENCE_RULES_VERSION`) que decidiu os fatos de uma execução. Um dia publicado a partir do cache usa fatos decididos pelas regras de quando o banco foi coletado. Depois de uma mudança das regras, esse dia saía com as regras antigas sem nenhuma marca no resumo da execução.

## Decisão

### Orçamento de espera por `maxlag`

`maxlag=5` continua em toda requisição. O que muda é quanto tempo o coletor espera o atraso passar.

- A espera por `maxlag` sai de um orçamento próprio, `MaxlagBudget`. O orçamento é por execução de `python main.py`: o CLI cria um só e o entrega a todos os clientes da Wikipedia e do Wikidata da execução. Requisições seguidas que recebem `maxlag` dividem o mesmo teto.
- O padrão é 15 minutos. A variável de ambiente `MAXLAG_BUDGET_SECONDS` troca o valor; `0` desiste no primeiro `maxlag`. Um valor negativo, infinito ou que não seja número encerra o CLI antes de qualquer requisição.
- Depois de cada `maxlag`, o cliente espera o `Retry-After` da resposta. Sem ele, usa o campo `lag` do erro; sem os dois, 5 segundos, o mínimo que o próprio MediaWiki envia. A espera de uma resposta fica entre 5 e 120 segundos (`MAX_RETRY_AFTER_SECONDS`). Um `Retry-After` maior é cortado para 120 e a requisição é repetida, porque quem decide a desistência é o orçamento da execução.
- Quando resta menos que a espera pedida, o cliente espera o que resta e tenta uma última vez. Com o orçamento zerado, levanta `MediaWikiError(..., code="maxlag", transient=True)` com a mensagem `MediaWiki maxlag at <API> did not clear within the run's <N>s wait budget (MAXLAG_BUDGET_SECONDS); last answer: <mensagem do servidor>`. O CLI sai com 75 e o script de rebuild faz outra tentativa.
- As esperas por `maxlag` não consomem as 3 novas tentativas de erro de rede e de HTTP 429 ou 5xx, e o backoff desses erros não sai do orçamento.

O orçamento conta as pausas concedidas. O tempo das próprias requisições fica de fora; cada pausa dura pelo menos 5 segundos, então uma execução faz no máximo uma requisição atrasada a cada 5 segundos de orçamento.

### Por que 15 minutos

- O ADR 032 dá 30 minutos a cada tentativa e não repete a tentativa encerrada pelo timeout (código 124). Com 15 minutos de espera e cerca de 2 de trabalho, um atraso persistente termina em 75, que leva a nova tentativa, com folga de 13 minutos para o backoff de rede. `tests/test_rebuild_database.py` falha se o padrão passar da metade do timeout da tentativa.
- Com 3 tentativas e 2 esperas de 10 minutos, o rebuild só recorre ao cache quando o atraso dura cerca de 70 minutos. Antes bastavam cerca de 20.
- O agendamento pede 15:00 UTC e o GitHub tem iniciado o job entre 19:00 e 24:00 UTC. A meia-noite de São Paulo é às 03:00 UTC. Um job que começa às 24:00 UTC e gasta o orçamento inteiro nas 3 tentativas termina o rebuild por volta de 01:15 UTC. O pior caso do passo, 111,5 minutos, termina por volta de 02:00 UTC.

O workflow não define `MAXLAG_BUDGET_SECONDS`, e um teste falha se ele a definir. A variável existe para rodar o coletor à mão com outro teto.

### Cliente do WDQS

`WikidataQueryClient` (`release_discovery.py`) fica sem orçamento. O endpoint SPARQL não aceita o parâmetro `maxlag` e não responde com esse erro. A mensagem `Waiting for wdqs...` dos logs vem da Action API do Wikidata, que soma o atraso do serviço de consulta ao seu `maxlag`. Sobrecarga do WDQS chega como HTTP 429 ou 5xx, que o cliente já repete e marca como transitória.

### Piloto do mapa

`map_pilot_refresh` usa `WikidataEntityClient` fora do CLI do coletor. O workflow `map-pilot-refresh.yml` roda o comando até 4 vezes, com 15 minutos entre elas, num passo de 90 minutos. Com 15 minutos de orçamento por execução, as esperas somariam 105 minutos. O comando cria o cliente com 5 minutos de orçamento: no pior caso, 65 minutos de espera, e 25 para o trabalho. Um teste lê o workflow e falha se as esperas deixarem menos de 20 minutos.

### Versão das regras de evidência

- A migração 11 acrescenta `fact_runs.evidence_rules_version TEXT`. Linhas anteriores ficam com `NULL`, porque a versão que as decidiu não é conhecida.
- `FactStore.start_run` grava `EVIDENCE_RULES_VERSION`. A execução de fatos e a de lançamentos passam por ele.
- `run_daily_puzzles` devolve `evidence_rules` com `code` (a versão do código) e `database` (a versão da última execução de fatos concluída, ou `None`). O runner abre o banco só para leitura e não migra. Um banco anterior à migração, que o cron pode restaurar do cache, devolve `None`.
- `daily_puzzles_cli` imprime `Evidence rules: database <versão>, code <versão>`. Quando as duas diferem, inclusive com `None`, escreve o aviso em stderr e, no GitHub Actions, emite `::warning title=Evidence rules differ::` com as duas versões.

O valor fica no resultado do runner e no log do job. Nenhum arquivo publicado o carrega, e `web/` não lê nada novo.

## Alternativas consideradas

### Aumentar `maxlag`

Um `maxlag` de 15 ou 20 segundos faria quase todas as requisições de novembro passarem na primeira tentativa. A etiqueta da API pede `maxlag=5` a robôs justamente para que eles recuem quando o Wikidata está atrasado, e o operador decidiu manter o valor.

### Mais novas tentativas por requisição

O orçamento ficaria por requisição: 100 requisições atrasadas poderiam esperar 100 vezes o teto, e a tentativa estouraria os 30 minutos com 124, que o ADR 032 não repete. Um orçamento por execução limita a soma.

### Orçamento por cliente

O CLI cria até 8 clientes da Wikipedia e do Wikidata numa execução. Com um orçamento por cliente, a soma chegaria a 120 minutos. O cliente criado sozinho, fora do CLI, ainda recebe um orçamento próprio, para que nenhum chamador fique sem teto.

### Esperar até a meia-noite de São Paulo

Um orçamento de horas caberia na janela até as 03:00 UTC, mas ficaria acima dos 30 minutos da tentativa. A tentativa terminaria em 124 e o dia sairia do cache depois de uma única tentativa.

### Guardar a versão das regras num arquivo publicado

A versão poderia ir para o manifesto ou para o registro de publicação de cada jogo. Isso mudaria contratos que o cliente web valida e exigiria nova versão de schema. O problema a resolver é a falta de marca no resumo da execução, e o aviso do job resolve isso sem mudar o que o site lê.

## Consequências

- Uma noite com o Wikidata atrasado por até cerca de 70 minutos publica fatos novos. Antes, 20 minutos de atraso bastavam para publicar do cache.
- Uma tentativa que encontra o atraso gasta até cerca de 17 minutos antes de sair com 75. O pior caso do passo continua sendo o do ADR 032, 111,5 minutos.
- O backoff de rede e o orçamento de `maxlag` somam esperas independentes. Uma tentativa com rede instável e atraso longo ainda pode chegar aos 30 minutos.
- Todo dia publicado do cache depois de uma mudança das regras mostra `Evidence rules differ` no resumo da execução, com as duas versões. Até o primeiro rebuild bem-sucedido depois desta mudança, o aviso diz que a base não registrou versão.
- `map_pilot_refresh` espera até 5 minutos por execução, contra os cerca de 255 segundos por requisição que as 8 novas tentativas davam.
