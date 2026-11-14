# ADR 037 sobre a publicação parcial do dia

## Status

Aprovado em 2026-11-14. Muda a política de falha do runner diário (`kpop_scraping/daily_puzzles_runner.py`), acrescenta o registro `daily-set.json` a cada conjunto publicado e põe um limite de tempo no passo `Generate daily puzzles` do `daily-puzzles-cron`. O contrato de cada jogo continua igual.

## Contexto

O runner gera oito jogos por dia: o Quiz (sessões base, diárias e por década, nos dois idiomas), a Grade, a Connections, o Adivinhe, o Caça-palavras, a Linha do Tempo, o Código de grupos e a Cruzadinha. Até aqui só a Grade, o Código de grupos e a Cruzadinha capturavam a própria falha, e só a de `ValueError`. A Cruzadinha também capturava `sqlite3.Error`. Qualquer erro nos outros cinco jogos, ou um `MemoryError` em qualquer um, terminava o CLI com código 1. Uma falha que acontecia só no conjunto de D+1 (`--ahead`) também perdia o dia D. O dia já estava promovido no diretório, e a falha do passo fazia o workflow pular o upload. O ADR 035 tornou explícito um desses casos, porque a Connections levanta `ValueError` ao esgotar o orçamento de 10.000 passos.

Os dados vêm da Wikipedia e do Wikidata, que qualquer editor muda. Uma edição pode fazer um gerador falhar, e um gerador só deveria tirar do ar o próprio jogo. No navegador, cada jogo já mostrava o estado de erro `missing` quando o arquivo do dia faltava. O resto do pipeline exigia os arquivos do Quiz, da Connections, do Adivinhe, do Caça-palavras e da Linha do Tempo. Os testes Python e web liam os dados publicados, o `astro check` do build importava quatro deles, e o smoke e2e do deploy exigia o tabuleiro de cada página.

O passo `Generate daily puzzles` não tinha `timeout-minutes`. O tempo normal é de 0,5 a 0,8 minuto, e com `cancel-in-progress: false` um run preso segura o grupo de concorrência e atrasa os seguintes.

## Decisão

### Cada jogo roda isolado

`generate_daily_puzzles` gera e valida cada jogo dentro de `_isolated`. Uma `Exception` qualquer deixa só aquele jogo fora do dia. `MemoryError` e `RecursionError` são subclasses de `Exception` e entram na regra. `KeyboardInterrupt` e `SystemExit` ficam de fora porque representam o cancelamento do run. Capturá-los publicaria um dia parcial que ninguém pediu. A validação do esquema roda dentro do isolamento, então um artefato inválido também tira só o próprio jogo.

O motivo completo da omissão é uma linha de até 500 caracteres (`daily_set.omission_reason`). Um `ValueError` usa a própria mensagem, que é a falha documentada dos geradores. Outro tipo de erro leva o nome da classe na frente, porque a mensagem pode vir vazia (`MemoryError`). Caracteres de controle viram espaço, e o aviso escapa `%`, CR e LF no formato dos comandos do GitHub Actions. O motivo pode citar texto da Wikipedia ou do Wikidata, e o escape impede que ele abra um comando novo no log. Esse motivo vai para o log, para o `::warning` e para o resultado do runner.

A Grade continua podendo manter a grade do dia anterior quando ela ainda passa na validação. A Cruzadinha continua registrando a omissão no próprio `crossword-publication.<data>.json`, agora também para falhas de outro tipo.

### `daily-set.json`

Todo conjunto gerado pelo runner leva `daily-set.json` (`kpop-daily-set-v1`) com a data do conjunto e o motivo de cada jogo ausente, indexado pelo nome que o gate de troca de tabuleiro usa (`quiz`, `grid`, `connections`, `name-guess`, `word-search`, `timeline`, `code-groups`, `crossword`). Um jogo conta como ausente quando o arquivo dele não está no conjunto. No Quiz, esse arquivo é o `manifest-v2.json`. Sem o Quiz, o conjunto não tem `manifest-v2.json`, `manifest-v3.json`, `session.pt-BR.json` nem `session.en.json`.

O registro é servido pelo site e versionado num repositório público. Uma mensagem de exceção pode trazer um caminho local ou texto interno, então o registro grava só uma categoria curta, `generation failed (<tipo da exceção>)`, montada por `daily_set.public_omission_reason`. Isso vale para os oito jogos, a Cruzadinha inclusive. O registro de publicação da Cruzadinha (`crossword-publication.<data>.json`), também público, guarda a mensagem de `ValueError` e de `sqlite3.Error`, como já fazia antes deste ADR, e só o tipo de qualquer outro erro.

Até aqui a data de um conjunto era a do `connections.daily.json`. Um conjunto sem a Connections perderia a data. O runner tomaria o dia já servido por um dia novo e geraria tudo de novo por cima, e o gate de troca de tabuleiro deixaria de comparar os outros jogos. Por isso o runner (`_published_day`) e o gate (`board_ids`) leem a data de `daily-set.json`. Um conjunto publicado antes do registro continua datado pela Connections, que todo conjunto antigo tem.

Um registro ilegível no diretório principal faz o run falhar antes de gravar qualquer arquivo, porque o dia servido não pode ser gerado de novo por engano. Em `next/`, que todo run gera de novo, um registro ilegível conta como diretório sem conjunto.

### Verificação

`web_publish.verify` usa o registro quando ele existe:

- um jogo listado como omitido não pode ter arquivo no conjunto;
- um arquivo exigido por `--require-*` só pode faltar quando o jogo está listado;
- os tabuleiros presentes, exceto a grade, têm de ter a `reference_date` do registro, e as sessões diárias do Quiz e os atalhos `session.<idioma>.json` têm de ter a data do registro na semente (`kpop-daily-<data>`). As sessões base e por década não têm data.

Sem o registro, valem as regras anteriores de cada flag. O comando `npm --prefix web run artifacts:verify` continua o mesmo e aceita um dia sem qualquer jogo, desde que o registro explique a ausência. `next/` é verificado quando tem `manifest-v2.json` ou `daily-set.json`.

Quando um dia mantido ou promovido perde a grade na revalidação, ou ganha ou perde a Cruzadinha na confirmação do histórico, o runner atualiza o registro do diretório e o de `next/`.

### Build, testes e smoke e2e

Os testes que validavam os arquivos publicados validam o arquivo de cada jogo quando ele existe e pulam o jogo ausente. Os testes que usavam os dados publicados como entrada leem cópias congeladas (`tests/fixtures/web_publish/` no Python, `web/src/tests/fixtures/` na web). O smoke e2e pergunta ao site se cada arquivo foi publicado. Com o arquivo, a página precisa mostrar o tabuleiro. Sem ele, precisa mostrar o estado `missing`. A Linha do Tempo pode mostrar o tabuleiro de `next/` e o Quiz pode montar a rodada geral pelo catálogo. Um estado `invalid` sempre reprova. Para isso, os cinco jogos marcam o estado de erro com `data-testid="game-missing"` e `data-error-kind`, como a Grade, o Código de grupos e a Cruzadinha já faziam.

### Falha do run

`publish_daily_puzzles` levanta `NoGamePublishedError` antes de gravar qualquer arquivo quando nenhum jogo foi gerado para o dia. A grade mantida do dia anterior e uma Cruzadinha omitida não contam como jogo gerado. No dia D, o erro termina o CLI com código 1.

Qualquer `Exception` na geração ou na publicação de D+1 deixa o dia D instalado e registra `next_skipped` com o motivo. Uma falha antes da instalação deixa `next/` como estava, porque a instalação é atômica. Um `next/` que não passa na verificação depois da instalação é apagado. O run seguinte o gera de novo, e no cron o diretório principal já tem o dia servido. Um dia parcial sai com código 0. Os códigos 65 e 75 do ADR 032 continuam restritos ao coletor.

O catálogo de perguntas não é um jogo do dia, mas depende do mesmo conjunto de dados do Quiz. Uma falha ao montá-lo retira o catálogo, registra `catalog_skipped` e verifica o diretório de novo.

### Limite de tempo

O passo `Generate daily puzzles` ganha `timeout-minutes: 20`, mais de 20 vezes o tempo normal.

## Alternativas consideradas

### Manter o dia anterior do jogo que falhou

A Grade já faz isso. Para os outros jogos, o tabuleiro de ontem apareceria como o desafio de hoje, com a data errada no resultado e nas estatísticas do jogador. O Código de grupos e a Cruzadinha já recusavam essa troca pelo mesmo motivo.

### Falhar o run inteiro, como antes

Uma edição no Wikidata que derruba um gerador tiraria do ar os oito jogos e, com `--ahead`, também o dia seguinte.

### Pôr a lista de omitidos no `manifest-v2.json`

O manifesto tem campos fixos, e os clientes já publicados recusam um manifesto com campos a mais. Ele também some quando o Quiz é o jogo omitido.

## Consequências

- O conjunto de D é gerado em D-1 ao meio-dia, em `next/`. Quando ele omite um jogo, de 0h a 12h de D a página mostra o tabuleiro de D-1 marcado como antigo. De 12h de D, quando o cron promove o conjunto, até 12h de D+1, cerca de 24 horas, a página mostra o estado `missing`, mesmo com o tabuleiro de D+1 já em `next/`. Entre os cinco jogos deste ADR, só a Linha do Tempo consulta `next/` quando o diretório principal não tem o arquivo. Os outros quatro só consultam `next/` a partir de um arquivo do diretório principal, como o Código de grupos. A Grade e a Cruzadinha consultam `next/` mesmo sem o arquivo principal.
- Num `workflow_dispatch` com `--date` passado, rodado depois da meia-noite em São Paulo, `next/` guarda o dia corrente que o site serve. Se D+1 falhar e esse `next/` não verificar contra o diretório principal, ele é apagado e enviado, e o site volta ao tabuleiro anterior até o run seguinte. No cron isso não acontece, porque a data é a de hoje em São Paulo e o diretório principal já tem o dia promovido.
- O resumo do run mostra um `::warning` por jogo omitido, com o motivo, e o resultado do runner traz `<jogo>_skipped` (`quiz_skipped`, `grid_skipped`, `connections_skipped`, `name_guess_skipped`, `word_search_skipped`, `timeline_skipped`, `code_groups_skipped`, `crossword_skipped`).
- Um gerador que hoje falha de forma determinística só aparece como aviso. Quem acompanha o run precisa olhar o resumo.
- `daily-set.json` vira parte do conjunto publicado. Removê-lo de um conjunto com jogo omitido faz a verificação falhar, e removê-lo de um conjunto completo devolve as regras anteriores.
- Para reverter este ADR, apague também `web/public/data/daily-set.json` e `web/public/data/next/daily-set.json`. O código anterior instala o diretório principal sem remover arquivos que não conhece, e um registro velho ficaria dizendo a data de um dia já passado. Se o código deste ADR voltar depois, a verificação recusaria o conjunto ("is for X, but daily-set.json publishes D") até o cron seguinte.
