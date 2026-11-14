# ADR 034 sobre o grupo acima do limite de candidatos na descoberta de lançamentos

## Status

Aprovado em 2026-11-13. Muda `_parse_results` e `discover_releases` em `kpop_scraping/release_discovery.py`, `_mark_stale_releases` em `kpop_scraping/release_pipeline.py` e o resumo de `python main.py --releases`, e acrescenta a migração 12 (`release_discovery_groups.candidates_discarded`). Os limites de 25 grupos por consulta, de 100 candidatos por grupo e de 5 MB por resposta do WDQS continuam como estavam, e a consulta SPARQL também. O status do [ADR 032](032-rebuild-com-fallback-em-passo-separado.md) ganha uma nota: o limite de candidatos não leva mais ao código 65.

## Contexto

`--releases` consulta o WDQS com até 25 grupos aceitos do catálogo e recebe, para cada um, os itens com P175 apontando para o grupo e P31 de álbum, single ou EP. Quando um grupo vinha com mais de 100 candidatos distintos, `_parse_results` levantava `MediaWikiError("WDQS candidate limit exceeded for <QID>")`. O CLI saía com 65, o script de rebuild do ADR 032 não repetia a tentativa e o dia saía do banco em cache.

Qualquer editor do Wikidata pode criar itens com P175 apontando para um grupo. Enquanto esses itens existissem, todo rebuild diário falharia do mesmo jeito, e os fatos de todos os grupos, inclusive os que não dependem de lançamentos, ficariam parados na última coleta bem-sucedida. Um teste que simula a resposta do WDQS com 103 candidatos para um grupo confirmou o aborto, com código de saída 65, antes da mudança.

Na base local coletada em 2026-10-19, o grupo com mais candidatos numa descoberta tinha 95. Um grupo com discografia longa pode passar de 100 sem edição maliciosa.

## Decisão

### Corte por grupo

- `_parse_results` agrupa os candidatos distintos por grupo, ordena os de cada grupo pelo número do QID e mantém os 100 primeiros. O run continua, e os outros grupos da consulta não mudam.
- A ordem compara o número: `Q123` vem antes de `Q1000`. Pela ordem do texto, `Q1000` viria antes de `Q123` e o corte guardaria itens arbitrários. A comparação usa a quantidade de dígitos sem zeros à esquerda e, no empate, os dígitos como texto. Essa regra dá a ordem numérica sem `int()`, que recusa textos com mais de 4300 dígitos. O QID inteiro desempata grafias do mesmo número, como `Q07` e `Q7`.
- O resultado depende só do conteúdo da resposta. A ordem das linhas, a ordem de iteração de `set` e `dict` e o `PYTHONHASHSEED` não o alteram, e um teste roda o corte com três sementes de hash diferentes.
- O Wikidata numera itens novos em ordem crescente. Um lote de itens criados depois da discografia fica com os QIDs mais altos e é o que o corte deixa de fora.
- Um QID de lançamento precisa ser `Q` seguido de dígitos ASCII. `str.isdigit()`, usado antes, também aceita dígitos como `²` e `١`, que a ordem numérica não trata. Um QID fora desse formato encerra a descoberta como resposta recusada, com código 65.

### Registro e aviso

- A migração 12 acrescenta `release_discovery_groups.candidates_discarded INTEGER NOT NULL DEFAULT 0`, com `CHECK(candidates_discarded >= 0)`. As descobertas anteriores ficam com 0, que é o valor correto para elas: acima do limite, o run abortava.
- `discover_releases` devolve `DiscoveryResult(run_id, truncated)`. Cada item de `truncated` traz o QID do grupo, o total de candidatos e quantos ficaram.
- Para cada grupo cortado, o CLI escreve em stderr `WARNING: WDQS returned <N> release candidates for group <QID>; kept the 100 with the lowest QIDs and discarded <N - 100>`. No GitHub Actions, imprime o mesmo texto em `::warning title=Release candidates truncated::`, como os avisos de `daily_puzzles_cli`. O script de rebuild roda o coletor com a saída herdada, então a linha chega ao log do job e ao resumo da execução. O resumo final ganha `Release discovery: <n> group(s) truncated at 100 candidates`.
- A mensagem leva o QID do grupo, que vem do banco e passou pela validação de `build_query`, e números. Nenhum texto da resposta do WDQS entra no comando do workflow.
- O corte não é falha: o run termina com 0 e o script de rebuild não restaura o cache.

### Lançamentos de um grupo cortado não ficam obsoletos

`_mark_stale_releases` marca como obsoletos (`stale`) os lançamentos aceitos de um grupo do lote que a descoberta atual não encontrou, e com eles os fatos e as páginas da Wikipedia. Num grupo cortado, um lançamento ausente pode estar entre os candidatos descartados. Sem ajuste, cada candidato além do 100º retiraria um lançamento aceito e os fatos dele.

O escopo da marcação considera só os grupos com `candidates_discarded = 0`. Os lançamentos e fatos de um grupo cortado mantêm o estado da última descoberta completa do grupo, como acontecia quando o run abortava e o dia saía do cache. Para um lançamento que também pertence a outro grupo, a linha aceita do grupo cortado conta como fora do escopo e protege os fatos do lançamento.

### Limite de 5 MB

Uma resposta do WDQS acima de 5 MB continua encerrando a descoberta com `MediaWikiError` sem a marca de transitória, e o CLI sai com 65. Esse limite protege a memória e o disco do coletor e não depende de um grupo. Um teste fixa o valor de `MAX_RESPONSE_BYTES`, o padrão do cliente e o código de saída.

## Alternativas consideradas

### Manter o aborto

O run inteiro dependeria de nenhum grupo do lote passar de 100 candidatos, uma condição que qualquer editor do Wikidata controla. Fatos de grupos sem relação com o grupo editado também deixariam de ser atualizados.

### Descartar o grupo inteiro

O grupo cortado ficaria sem nenhum candidato nesse run. A descoberta perderia lançamentos legítimos que o corte por QID mantém, e o grupo precisaria da mesma exceção na marcação de obsoletos.

### Ordenar pelo QID como texto

A consulta já devolve `ORDER BY ?performer ?release`, que no WDQS compara as URIs como texto. O corte guardaria `Q1000` antes de `Q123`, e a escolha deixaria de seguir a ordem de criação dos itens.

### Aumentar o limite de 100

Um limite maior adiaria o problema sem removê-lo, e cada candidato entra nas requisições ao `wbgetentities` e às três Wikipedias. O limite continua com o valor que já tinha.

### Guardar o corte só no log

O aviso informa o operador. `_mark_stale_releases` lê o escopo da descoberta no banco, e sem a coluna a proteção dos lançamentos de um grupo cortado não teria de onde ler o corte.

## Consequências

- Um grupo com mais de 100 candidatos deixa de derrubar o rebuild diário. O dia publica fatos novos e mostra `Release candidates truncated` no resumo da execução enquanto o estado do Wikidata persistir.
- Um grupo cortado não ganha nenhum lançamento cujo QID fique acima do 100º, e os lançamentos já aceitos dele não ficam obsoletos até uma descoberta completa.
- A migração 12 é aditiva. Reverter a decisão exige outra migração para remover a coluna ou deixá-la sem uso.
- O caso de `tests/test_cli.py` que classificava o erro de limite de candidatos como 65 usa agora o erro de resposta acima de 5 MB.
