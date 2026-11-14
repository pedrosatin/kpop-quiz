# ADR 035 sobre a busca preguiçosa da Connections

## Status

Aprovado em 2026-11-13. Muda a ordem em que o gerador da Connections percorre os critérios e os grupos, e com ela o tabuleiro de datas ainda não publicadas. O contrato do artefato, a regra de unicidade da partição, a regra das categorias "N integrantes" e a ordem de dificuldade continuam iguais.

## Contexto

O gerador escolhe 4 critérios entre os ativos e, para cada conjunto, procura 4 quadras disjuntas de grupos cuja partição seja única (ADR 009). Até aqui ele montava a lista completa de cada nível com `list(itertools.combinations(..., 4))`, embaralhava a lista com a semente da data e só então testava a primeira quadra. O mesmo acontecia com os conjuntos de critérios. O limite de 40 avaliações contava apenas o nível mais interno, e não havia limite para o tabuleiro inteiro.

O custo dessa montagem cresce com a quarta potência do tamanho do maior critério. Num laptop com Python 3.14, uma única avaliação com critérios de 4, 5, 6 e 100 grupos levou 15,1 s e 332 MiB de pico no `tracemalloc`. Com 300 grupos, o processo parou com `MemoryError` sob um teto de 2 GiB. O maior critério do catálogo de 2026-11-13 (`formed_2010s`) tem 61 grupos. O mesmo catálogo tem outros 188 grupos com formação na década de 2010 recusada pela validação, quase todos por falta de evidência. Cada um entra no critério quando uma revisão da fonte sustenta o fato. Um tabuleiro que estoura a memória derruba a geração diária.

## Decisão

### Ordem preguiçosa determinística

`kpop_scraping/lazy_order.py` sorteia uma permutação de `range(C(n, k))` um elemento por vez, com o Fisher-Yates que guarda só as posições trocadas. Cada índice vira uma quadra pelo sistema numérico combinatório (`combination_at`). Depois de k sorteios a memória guarda no máximo k posições, seja qual for o tamanho do intervalo, e cada quadra sai uma única vez. Todas as permutações têm a mesma probabilidade, como em `random.shuffle`.

O gerador usa essa ordem para os conjuntos de critérios e para as quadras de cada nível. A ordem depende só do `random.Random` semeado com o SHA-256 da semente da data e das listas ordenadas de ids. Nenhum passo lê a ordem de `set` ou `dict` de strings, então o tabuleiro de uma data é o mesmo em qualquer processo, com qualquer `PYTHONHASHSEED`.

### Orçamento

Um passo é um conjunto de critérios sorteado, uma quadra sorteada em qualquer nível ou uma checagem de unicidade. Cada tabuleiro tem um orçamento de 10.000 passos (`MAX_SEARCH_STEPS`). Ao esgotá-lo, `generate_connections_puzzle` levanta `ValueError` com a semente, o limite e os passos gastos de cada tipo. Dentro de um conjunto de critérios, a busca desiste e segue para o próximo depois de 40 checagens de unicidade, como antes, ou de 400 quadras sorteadas (`MAX_DRAWS_PER_COMBO`), o que cobre o caso em que as quadras de um nível deixam menos de 4 grupos para o nível seguinte.

No catálogo de 2026-11-13, as sementes diárias de 365 datas a partir de 2026-11-15 gastaram de 6 a 1.590 passos, sem nenhuma falha. No pior caso medido, em que todo conjunto de 16 grupos admite mais de uma partição, cada checagem de unicidade levou cerca de 4,5 ms e o orçamento se esgotou em cerca de 21 s.

### Tabuleiros publicados

A ordem nova gera outros tabuleiros para as mesmas datas. Os tabuleiros já publicados em `web/public/data` e em `next/` são mantidos pelo runner, como qualquer dia publicado, e o gate de troca de tabuleiro continua valendo. Uma data gerada de novo com `--regenerate` recebe o tabuleiro da ordem nova.

## Alternativas consideradas

### Limitar o número de grupos por critério

Cortar cada critério em 60 grupos limitaria a lista. O corte tiraria do sorteio grupos que satisfazem o critério e exigiria escolher quais ficam. Um corte pela ordem dos ids enviesaria o tabuleiro para os QIDs menores.

### Manter as listas e contar o orçamento antes de montá-las

O orçamento pararia a busca depois da primeira lista, que já custa C(n, 4) quadras. O custo da montagem não depende de quantas quadras a busca usa.

### Sortear quadras com reposição

Sortear 4 grupos ao acaso a cada passo dispensa o estado da permutação. Esse sorteio repete quadras e não sabe quando o nível acabou. A busca não conseguiria distinguir um nível esgotado de um nível com pouca sorte, e os conjuntos pequenos dos testes deixariam de terminar com a mensagem de que não há tabuleiro possível.

## Consequências

- O tempo e a memória da busca acompanham os passos sorteados. Um critério de 300 grupos custa cerca de 1 ms na primeira avaliação.
- Um catálogo em que nenhum tabuleiro tem solução única em 10.000 passos faz a Connections do dia falhar com `ValueError`, a mesma classe de erro de "Unable to generate a solvable connections puzzle".
- Os limites `MAX_SEARCH_STEPS` e `MAX_DRAWS_PER_COMBO` ficam em `kpop_scraping/connections_generator.py`. Mudar qualquer um deles pode mudar o tabuleiro das datas que estavam perto do limite.
- `lazy_order.py` não depende da Connections e serve a outros geradores que precisem percorrer combinações ou produtos grandes numa ordem dada pela semente.
