# ADR 039 sobre a Connections ambígua já servida

## Status

Aprovado em 2026-11-14. Muda o que o runner diário (`kpop_scraping/daily_puzzles_runner.py`) faz quando o tabuleiro da Connections que ele mantém ou promove admite uma segunda partição no banco. O contrato do artefato, a regra de unicidade do gerador e o registro `daily-set.json` do [ADR 037](037-publicacao-parcial-do-dia.md) continuam iguais.

## Contexto

O runner confere contra o banco o tabuleiro da Connections que mantém no diretório principal ou promove de `next/` ([ADR 009](009-mecanica-palavras-conectadas.md)). Até aqui, um tabuleiro com duas partições levantava `ValueError` antes da instalação. O CLI saía com código 1, nenhum jogo do dia chegava ao diretório principal e o conjunto de D+1 não saía. No run seguinte, a Cruzadinha ficava sem histórico. O registro do dia que faltou existia só em `next/`, e o runner o procurava apenas no diretório principal.

Uma partição a mais aparece quando o banco ganha fatos de gravadora que trocam um grupo entre duas categorias do tabuleiro. Uma edição legítima no Wikidata provoca isso, e uma edição feita de propósito também. O tabuleiro de D fica em `next/` desde o run de D-1, e o site o serve a partir da meia-noite em São Paulo. O cron roda por volta do meio-dia. Quando o run encontra a ambiguidade, os jogadores do dia já estão jogando aquele tabuleiro.

O ADR 037 isolou cada jogo na geração. A checagem da partição roda na promoção do dia, fora desse isolamento.

## Decisão

### Tabuleiro já servido

`_check_connections_partition` registra `{"checked": true, "reason": "ambiguous"}` em `connections_partition` e não levanta erro. O runner instala o conjunto promovido com os bytes já servidos e segue com a revalidação da Grade, a confirmação da Cruzadinha e o `--ahead`. O CLI emite o aviso `Daily connections ambiguous` pelo mesmo `warn` dos outros avisos, com o id do tabuleiro e a data. Os dois valores vêm do conjunto já verificado. O run sai com código 0.

A regra vale também para o tabuleiro mantido no diretório principal, numa segunda execução no mesmo dia, porque ele também já foi servido.

O tabuleiro continua publicado. O `daily-set.json` não o lista entre os omitidos, e o gate de troca de tabuleiro não acusa troca, porque os bytes ficam iguais. `validate_connections_partition_unique` levanta `AmbiguousPartitionError`, subclasse de `ValueError`, e o runner captura só essa classe. Qualquer outro erro da checagem para o run, como antes.

Sem banco, a checagem continua registrada como não executada (`{"checked": false, "reason": "no database"}`).

### Tabuleiro novo

O gerador continua recusando um tabuleiro com mais de uma partição. Quando nenhum tabuleiro de partição única cabe no orçamento do [ADR 035](035-busca-preguicosa-da-connections.md), o dia sai sem a Connections, pela regra do ADR 037. Quando o operador pede `--regenerate`, o gerador monta um tabuleiro novo para a data com a mesma checagem.

### Histórico da Cruzadinha

`crossword_publication.confirmed_record` recebe o diretório do conjunto publicado adiantado. Quando o diretório principal não tem o registro de um dia, o runner lê o registro desse dia em `next/`, porque o site serviu o dia de lá. O registro do diretório principal vence quando os dois existem, como em `verify_history`. Um registro ilegível em `next/` conta como ausente, e a Cruzadinha do dia seguinte fica omitida por falta de histórico, como antes. O runner usa essa leitura ao gerar um dia e ao conferir o histórico de um dia mantido ou promovido.

## Alternativas consideradas

### Gerar de novo a Connections de D como troca declarada

É o mecanismo que a Grade usa em `_revalidate_published_grid`, e o gate já o aceita. O tabuleiro mudaria no meio do dia, e quem estava jogando perderia o progresso desse jogo.

### Omitir a Connections de D

O jogo sumiria depois de servido, com a partida de quem já tinha começado.

### Parar o run, como antes

Uma checagem de um só jogo derrubava os oito jogos de D e o conjunto de D+1.

## Consequências

- Até o fim do dia, o jogo pode marcar como errado um agrupamento alternativo válido do tabuleiro mantido.
- Cada run que mantém esse tabuleiro no mesmo dia repete o aviso.
- O tabuleiro de D+1, gerado no mesmo run, passa pela regra de unicidade do gerador.
- Reverter este ADR faz a ambiguidade parar o run inteiro de novo e devolve a Cruzadinha sem histórico no dia seguinte a um run que não instalou o dia.
