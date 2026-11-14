# ADR 034 sobre o grupo acima do limite de candidatos na descoberta de lançamentos

## Status

Aprovado em 2026-11-13. Muda `_parse_results` e `discover_releases` em `kpop_scraping/release_discovery.py`, `_mark_stale_releases` em `kpop_scraping/release_pipeline.py` e o resumo de `python main.py --releases`, e acrescenta a migração 12 (`release_discovery_groups.candidates_discarded` e `release_discovery_groups.last_kept_wikidata_id`). Os limites de 25 grupos por consulta, de 100 candidatos por grupo e de 5 MB por resposta do WDQS continuam como estavam, e a consulta SPARQL também. O status do [ADR 032](032-rebuild-com-fallback-em-passo-separado.md) ganha uma nota, segundo a qual o limite de candidatos não leva mais ao código 65.

## Contexto

`--releases` consulta o WDQS com até 25 grupos aceitos do catálogo e recebe, para cada um, os itens com P175 apontando para o grupo e P31 de álbum, single ou EP. Quando um grupo vinha com mais de 100 candidatos distintos, `_parse_results` levantava `MediaWikiError("WDQS candidate limit exceeded for <QID>")`. O CLI saía com 65, o script de rebuild do ADR 032 não repetia a tentativa e o dia saía do banco em cache.

Qualquer editor do Wikidata pode criar itens com P175 apontando para um grupo. Enquanto esses itens existissem, todo rebuild diário falharia do mesmo jeito, e os fatos de todos os grupos, inclusive os que não dependem de lançamentos, ficariam parados na última coleta bem-sucedida. Um teste que simula a resposta do WDQS com 103 candidatos para um grupo confirmou o aborto, com código de saída 65, antes da mudança.

Na base local coletada em 2026-10-19, o grupo com mais candidatos numa descoberta tinha 95. Um grupo com discografia longa pode passar de 100 sem edição maliciosa.

## Decisão

### Corte por grupo

- `_parse_results` agrupa os candidatos distintos por grupo, ordena os de cada grupo pelo número do QID e mantém os 100 primeiros. O run continua, e os outros grupos da consulta não mudam.
- A ordem compara o número, então `Q123` vem antes de `Q1000`. Pela ordem do texto, `Q1000` viria antes de `Q123` e o corte guardaria itens arbitrários. Como o QID aceito não tem zeros à esquerda, a comparação usa o tamanho do QID e, no empate, o QID como texto. Essa regra dá a ordem numérica sem `int()`, que recusa textos com mais de 4300 dígitos, e um teste a compara com `int()` em QIDs de até 30 dígitos.
- O resultado depende só do conteúdo da resposta. A ordem das linhas, a ordem de iteração de `set` e `dict` e o `PYTHONHASHSEED` não o alteram, e um teste roda o corte com três sementes de hash diferentes.
- O Wikidata numera itens novos em ordem crescente. Um lote de itens criados depois da discografia fica com os QIDs mais altos e é o que o corte deixa de fora. Itens antigos têm QID baixo. Um editor que acrescente P175 e P31 a itens antigos que já existem põe esses itens na frente da discografia e empurra lançamentos legítimos para fora dos 100.
- Um QID de lançamento precisa estar na forma canônica: `Q`, um dígito ASCII de 1 a 9 e outros dígitos ASCII (`Q[1-9][0-9]*`). `str.isdigit()`, usado antes, também aceita dígitos como `²` e `١`, que a ordem numérica não trata, e `Q7`, `Q07` e `Q007` contariam como três candidatos e ocupariam três vagas. Um QID fora desse formato encerra a descoberta como resposta recusada, com código 65. `build_query` aplica a mesma regra aos QIDs dos grupos.

### Registro e aviso

- A migração 12 acrescenta `release_discovery_groups.candidates_discarded INTEGER NOT NULL DEFAULT 0`, com `CHECK(candidates_discarded >= 0)`. As descobertas anteriores ficam com 0, o valor correto para elas, porque acima do limite o run abortava.
- A mesma migração acrescenta `release_discovery_groups.last_kept_wikidata_id TEXT`, o maior QID que o corte manteve no grupo. A coluna fica preenchida só quando `candidates_discarded > 0`, e um `CHECK` exige nesse caso um QID canônico e, sem corte, `NULL`. As descobertas anteriores ficam com `NULL`.
- `discover_releases` devolve `DiscoveryResult(run_id, truncated)`. Cada item de `truncated` traz o QID do grupo, o total de candidatos, quantos ficaram e o último QID mantido.
- Para cada grupo cortado, o CLI escreve em stderr `WARNING: WDQS returned <N> release candidates for group <QID>; kept the 100 with the lowest QIDs and discarded <N - 100>`. No GitHub Actions, imprime o mesmo texto em `::warning title=Release candidates truncated::`, como os avisos de `daily_puzzles_cli`. O script de rebuild roda o coletor com a saída herdada, então a linha chega ao log do job e ao resumo da execução. O resumo final ganha `Release discovery: <n> group(s) truncated at 100 candidates`.
- A mensagem leva o QID do grupo, que vem do banco e passou pela validação de `build_query`, e números. Nenhum texto da resposta do WDQS entra no comando do workflow.
- Um run com corte termina com 0, e o script de rebuild não restaura o cache.

### Lançamentos que o corte pode ter escondido não ficam obsoletos

`_mark_stale_releases` marca como obsoletos (`stale`) os lançamentos aceitos de um grupo do lote que a descoberta atual não encontrou, e com eles os fatos e as páginas da Wikipedia. Num grupo cortado, um lançamento ausente pode estar entre os candidatos descartados. Sem ajuste, cada candidato além do 100º retiraria um lançamento aceito e os fatos dele.

Todo candidato descartado tem QID maior que `last_kept_wikidata_id`. Por isso a marcação poupa só a linha aceita de um grupo cortado cujo QID vem depois desse limite e que o run atual não tem entre os candidatos do grupo, porque esse lançamento pode estar entre os descartados. As outras linhas do grupo seguem a regra de uma descoberta completa. Um lançamento ausente com QID até o limite fica obsoleto, porque o corte não o descartou. Um lançamento que o run manteve e rejeitou também fica obsoleto. Os candidatos mantidos passam pela confirmação de `collect_release_facts` como em qualquer run e, se confirmados, entram como aceitos com fatos novos.

A comparação em SQL usa a mesma regra do corte: um QID canônico vem depois de outro quando tem mais caracteres ou, com o mesmo tamanho, quando vem depois como texto. `CAST(... AS INTEGER)` satura em 2^63 - 1 e empataria QIDs maiores. A linha poupada continua aceita e protege os fatos e as páginas do lançamento, mesmo quando outro grupo do lote não encontrou o mesmo lançamento e teve a própria linha marcada como obsoleta.

### Limite de 5 MB

Uma resposta do WDQS acima de 5 MB continua encerrando a descoberta com `MediaWikiError` sem a marca de transitória, e o CLI sai com 65. Esse limite protege a memória e o disco do coletor e não depende de um grupo. Um teste fixa o valor de `MAX_RESPONSE_BYTES`, o padrão do cliente e o código de saída.

## Alternativas consideradas

### Manter o aborto

O run inteiro dependeria de nenhum grupo do lote passar de 100 candidatos, uma condição que qualquer editor do Wikidata controla. Fatos de grupos sem relação com o grupo editado também não seriam atualizados.

### Descartar o grupo inteiro

O grupo cortado ficaria sem nenhum candidato nesse run. A descoberta perderia lançamentos legítimos que o corte por QID mantém, e o grupo precisaria da mesma exceção na marcação de obsoletos.

### Ordenar pelo QID como texto

A consulta já ordena por `?performer ?release`, e o WDQS compara as URIs como texto. O corte guardaria `Q1000` antes de `Q123`, e a escolha não seguiria a ordem de criação dos itens.

### Aumentar o limite de 100

Um limite maior adiaria o problema sem removê-lo, e cada candidato entra nas requisições ao `wbgetentities` e às três Wikipedias. O limite continua com o valor que já tinha.

### Guardar o corte só no log

O aviso informa o operador. `_mark_stale_releases` lê o escopo da descoberta no banco, e sem a coluna a proteção dos lançamentos de um grupo cortado não teria de onde ler o corte.

## Consequências

- Um grupo com mais de 100 candidatos não derruba mais o rebuild diário. O dia publica fatos novos e mostra `Release candidates truncated` no resumo da execução enquanto o estado do Wikidata persistir.
- Um grupo cortado não ganha nenhum lançamento cujo QID fique acima do 100º. Os lançamentos já aceitos dele com QID acima do último mantido continuam aceitos até uma descoberta que os alcance. Uma discografia legítima acima de 100 em todo run mantém esses lançamentos aceitos sem nova confirmação.
- A migração 12 é aditiva. Reverter o código deixa as duas colunas no banco, sem uso. Removê-las exige outra migração.
- O caso de `tests/test_cli.py` que classificava o erro de limite de candidatos como 65 usa agora o erro de resposta acima de 5 MB.
