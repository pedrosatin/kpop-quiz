# ADR 030 sobre a partida diária por jogo e data

## Status

Aprovado em 2026-11-11. Muda a identidade com que a web registra a partida diária nas estatísticas locais. O gate de troca de tabuleiro do cron (#359) e a promoção de `next/` não mudam.

## Contexto

Cada jogo diário registrava a partida concluída numa chave do `localStorage` (`kpop-match-recorded-<jogo>-<id>`) e só contava a partida se a chave não existisse. O id era o do tabuleiro. Conexões, Adivinhe, Linha do Tempo, Caça-palavras e Código usavam o `puzzle_id`, e a Cruzadinha o `dataset_version`. A Grade usava a `reference_date`, o Quiz diário `daily-<data>` e o Mapa `map-<data>`.

O pipeline troca o tabuleiro de uma data já publicada em três caminhos legítimos: `--regenerate`, a revalidação da Grade e a Cruzadinha gerada de novo na promoção. O histórico do git tem 8 datas com dois tabuleiros diferentes em cada jogo (2026-09-19, 09-22, 09-27, 10-04, 10-05, 10-16, 10-18 e 10-19; a última veio da PR #228). Quem terminou o dia e voltava depois da troca recebia um tabuleiro novo, jogava de novo e contava duas vezes em `played`, em `won` e na sequência. O evento `daily` do analytics fazia a mesma conta. O Código salvava o progresso pela data, sem o `puzzle_id`, e aplicava os palpites do tabuleiro anterior ao segredo novo.

## Decisão

### Identidade

A partida diária é identificada pelo jogo e pela `reference_date` do desafio. A chave passa a ser `kpop-match-recorded-<jogo>-daily-<data>`, montada por `dailyMatchId` em `web/src/lib/player-stats.ts`. `recordMatchOnce` é o único ponto que grava: com data, confere a chave da data e marca só ela; sem data (o Quiz geral), segue chaveado pela partida, como antes.

O Quiz diário já gravava `daily-<data>` e continua com a mesma chave. O evento de desafio diário do analytics (`isDaily`) usa a mesma consulta, `isDailyMatchRecorded`.

### Migração da chave antiga

A chave antiga não é apagada nem reescrita. Na leitura, `isDailyMatchRecorded(jogo, data, idAntigo)` também aceita a chave do tabuleiro atual no formato antigo (`<jogo>-<puzzle_id>`, `crossword-<dataset_version>`, `grid-<data>`, `map-<data>`). Quem terminou o dia antes do deploy e abre o mesmo tabuleiro depois não ganha uma segunda contagem. As estatísticas (`kpop-player-stats-v1`) e o formato de exportação não mudam.

### Dia concluído depois da republicação

O progresso salvo continua chaveado pelo tabuleiro, o que já descarta o progresso de outro tabuleiro. Ao montar, cada jogo lê se a data já foi registrada (`useDailyMatchDone`). Se foi e o tabuleiro atual não tem save concluído, o jogo mostra `DailyDone`: o título "Desafio de hoje concluído" / "Today's challenge is done", uma frase que explica a atualização e o `DailyNext`. O resultado detalhado da partida anterior não aparece, porque o save dela pertence ao outro tabuleiro.

O Quiz diário não troca a tela. A configuração inicial também escolhe o tema e o modo, e o desafio diário existe em mais de um modo. Com a data registrada, ela mostra "Você já concluiu o desafio diário de hoje. Uma nova rodada não conta nas estatísticas." e mantém o botão de começar.

O Mapa fica de fora. O tabuleiro dele deriva da data e o save já é da data.

### Save do Código

O save `kpop-code-<data>` passa a guardar o `puzzle_id`. Um save com outro `puzzle_id`, ou sem ele, é descartado em vez de retomado.

## Alternativas consideradas

### Reescrever as chaves antigas para o formato novo

Exigiria saber a data de cada `puzzle_id` antigo, o que a web não tem sem o artefato daquele dia. A leitura das duas chaves cobre o caso que importa, o tabuleiro em uso no dia do deploy, sem varrer o `localStorage`.

### Usar o `lastPlayedDate` das estatísticas como identidade

Ele guarda só o último dia jogado de cada jogo e muda com importação e reinício das estatísticas. Não responde por uma data anterior, nem separa a partida de um tabuleiro arquivado.

### Recusar a troca de tabuleiro no pipeline

O gate do #359 já recusa a troca não declarada. As trocas declaradas corrigem dados errados e continuam necessárias.

## Consequências

- Uma republicação não muda `played`, `won`, as sequências nem o evento `daily` de quem já terminou a data.
- Quem terminou o dia no tabuleiro anterior vê o dia concluído, sem o resultado detalhado.
- Quem estava no meio de uma partida quando o tabuleiro mudou começa o tabuleiro novo do zero, e essa partida conta normalmente.
- O jogo não distingue tabuleiro trocado de save apagado. Quem apaga o save do tabuleiro e mantém o registro da partida também vê o dia concluído, em vez de uma partida que não contaria.
- O save do Código gravado antes desta mudança não tem `puzzle_id` e é descartado uma vez. Se a partida já estava registrada, o jogo mostra o dia concluído. Se estava em andamento, o jogador recomeça o dia.
- Caso não coberto: o deploy entra no mesmo dia de uma republicação, e o jogador terminou o tabuleiro anterior antes do deploy. A chave antiga dele aponta para o `puzzle_id` que não está mais publicado e não é reconhecida. Esse jogador conta a data uma segunda vez. O caso só acontece nesse dia.
- O cron, os artefatos e os schemas não mudam.
