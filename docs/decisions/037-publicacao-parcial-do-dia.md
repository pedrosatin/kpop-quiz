# ADR 037 sobre a publicação parcial do dia

## Status

Aprovado em 2026-11-14. Muda a política de falha do runner diário (`kpop_scraping/daily_puzzles_runner.py`), acrescenta o registro `daily-set.json` a cada conjunto publicado e põe um limite de tempo no passo `Generate daily puzzles` do `daily-puzzles-cron`. O contrato de cada jogo continua igual.

## Contexto

O runner gera oito jogos por dia: o Quiz (sessões base, diárias e por década, nos dois idiomas), a Grade, a Connections, o Adivinhe, o Caça-palavras, a Linha do Tempo, o Código de grupos e a Cruzadinha. Até aqui só a Grade, o Código de grupos e a Cruzadinha capturavam a própria falha, e só a de `ValueError` (mais `sqlite3.Error` na Cruzadinha). Qualquer erro nos outros cinco jogos, ou um `MemoryError` em qualquer um, terminava o CLI com código 1. Uma falha que acontecia só no conjunto de D+1 (`--ahead`) também perdia o dia D: o dia já estava instalado no diretório de trabalho, mas o workflow pulava o upload. A ADR 035 tornou explícito um desses casos, porque a Connections levanta `ValueError` ao esgotar o orçamento de 10.000 passos.

Os dados vêm da Wikipedia e do Wikidata, que qualquer editor muda. Uma edição pode fazer um gerador falhar, e um gerador só deveria tirar do ar o próprio jogo. Os clientes web já tratam um artefato ausente com o estado de erro `missing`.

O passo `Generate daily puzzles` não tinha `timeout-minutes`. O tempo normal é de 0,5 a 0,8 minuto, e com `cancel-in-progress: false` um run preso segura o grupo de concorrência e atrasa os seguintes.

## Decisão

### Cada jogo roda isolado

`generate_daily_puzzles` gera e valida cada jogo dentro de `_isolated`. Uma `Exception` qualquer deixa só aquele jogo fora do dia. `MemoryError` e `RecursionError` são subclasses de `Exception` e entram na regra. `KeyboardInterrupt` e `SystemExit` não entram: são o cancelamento do run, e capturá-los publicaria um dia parcial que ninguém pediu. A validação do esquema roda dentro do isolamento, então um artefato inválido também tira só o próprio jogo.

O motivo da omissão é uma linha de até 500 caracteres (`daily_set.omission_reason`). Um `ValueError` usa a própria mensagem, que é a falha documentada dos geradores. Outro tipo de erro leva o nome da classe na frente, porque a mensagem pode vir vazia (`MemoryError`). Caracteres de controle viram espaço, e o aviso escapa `%`, CR e LF no formato dos comandos do GitHub Actions. O motivo pode citar texto da Wikipedia ou do Wikidata, e o escape impede que ele abra um comando novo no log.

A Grade continua podendo manter a grade do dia anterior quando ela ainda passa na validação. A Cruzadinha continua registrando a omissão no próprio `crossword-publication.<data>.json`, agora também para falhas de outro tipo.

### `daily-set.json`

Todo conjunto gerado pelo runner leva `daily-set.json` (`kpop-daily-set-v1`) com a data do conjunto e o motivo de cada jogo ausente, indexado pelo nome que o gate de troca de tabuleiro usa (`quiz`, `grid`, `connections`, `name-guess`, `word-search`, `timeline`, `code-groups`, `crossword`). Um jogo conta como ausente quando o arquivo dele não está no conjunto. No Quiz, esse arquivo é o `manifest-v2.json`. Sem o Quiz, o conjunto não tem `manifest-v2.json`, `manifest-v3.json`, `session.pt-BR.json` nem `session.en.json`.

Até aqui a data de um conjunto era a do `connections.daily.json`. Um conjunto sem a Connections perderia a data: o runner tomaria o dia já servido por um dia novo e geraria tudo de novo por cima, e o gate de troca de tabuleiro deixaria de comparar os outros jogos. Por isso o runner (`_published_day`) e o gate (`board_ids`) leem a data de `daily-set.json`. Um conjunto publicado antes do registro continua datado pela Connections, que todo conjunto antigo tem.

### Verificação

`web_publish.verify` usa o registro quando ele existe:

- um jogo listado como omitido não pode ter arquivo no conjunto;
- um arquivo exigido por `--require-*` só pode faltar quando o jogo está listado;
- todo artefato presente, exceto a grade, tem de ser da data do registro.

Sem o registro, valem as regras anteriores de cada flag. O comando `npm --prefix web run artifacts:verify` continua o mesmo e aceita um dia sem qualquer jogo, desde que o registro explique a ausência. `next/` é verificado quando tem `manifest-v2.json` ou `daily-set.json`.

Quando um dia mantido ou promovido perde a grade na revalidação, ou ganha ou perde a Cruzadinha na confirmação do histórico, o runner atualiza o registro do diretório e o de `next/`.

### Falha do run

`publish_daily_puzzles` levanta `NoGamePublishedError` antes de gravar qualquer arquivo quando nenhum jogo foi gerado para o dia. A grade mantida do dia anterior e uma Cruzadinha omitida não contam como jogo gerado. No dia D, o erro termina o CLI com código 1. No dia D+1, o dia D já instalado fica, `next/` mantém o que tinha (o site só serve `next/` quando ele é mais novo que o diretório principal) e o resultado registra `next_skipped`. Um dia parcial sai com código 0. Os códigos 65 e 75 da ADR 032 continuam restritos ao coletor.

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

- Um jogo omitido aparece com o estado `missing` na página dele até o dia seguinte. Quando o diretório principal não tem o arquivo, o carregador da web não procura a cópia de `next/` depois da meia-noite. Esse comportamento já valia para a Grade e o Código de grupos.
- O resumo do run mostra um `::warning` por jogo omitido, com o motivo, e o resultado do runner traz `<jogo>_skipped` (`quiz_skipped`, `grid_skipped`, `connections_skipped`, `name_guess_skipped`, `word_search_skipped`, `timeline_skipped`, `code_groups_skipped`, `crossword_skipped`).
- Um gerador que hoje falha de forma determinística só aparece como aviso. Quem acompanha o run precisa olhar o resumo.
- `daily-set.json` vira parte do conjunto publicado. Removê-lo de um conjunto com jogo omitido faz a verificação falhar, e removê-lo de um conjunto completo devolve as regras anteriores.
