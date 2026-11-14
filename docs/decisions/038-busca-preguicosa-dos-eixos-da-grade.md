# ADR 038 sobre a busca preguiçosa dos eixos da Grade

## Status

Aprovado em 2026-11-14. Muda a ordem em que o gerador da Grade percorre os pares de eixos e, com ela, a grade de datas ainda não publicadas. O contrato do artefato, as 18 partições de categorias, a regra de nove respostas distintas, a contagem de integrantes e a regra de não repetir os critérios dos dias vizinhos continuam iguais.

## Contexto

O gerador escolhe um eixo de linhas e um de colunas entre 18 partições de categorias ([ADR 008](008-grade-de-intersecoes.md)). Até aqui `_select_axes` montava todos os eixos válidos de cada partição, juntava todos os pares linha × coluna numa lista, ordenava a lista, copiava e embaralhava a cópia com a semente da data. Só então testava o primeiro par. O fallback de eixos mistos (`_find_mixed_axis_grid`) montava e embaralhava todas as triplas de critérios ativos, sem limite de tentativas.

Os critérios de década (4) e de contagem de integrantes (12) são listas fixas no código. Os de gravadora vêm dos fatos, um por gravadora com pelo menos três grupos, sem limite. O número de pares cresce com o cubo do número de gravadoras. Com 15 gravadoras e os 12 critérios de integrantes há 412.822 pares, e a seleção levou 5,9 s num laptop com Python 3.14. Com 100 gravadoras são 116 milhões de pares, e o processo parou com `MemoryError` sob um teto de 2 GiB depois de 65 s de CPU. Cada data ímpar roda a seleção até quatro vezes, uma para cada vizinho, uma para a própria data e uma para confirmar que só restam grades dos vizinhos.

No banco local de 2026-10-19 há 10 gravadoras ativas e 17.656 pares, dos quais 2 têm as nove casas preenchidas. Na cópia desse banco com os anos de formação da [ADR 029](029-ano-de-formacao-pela-categoria.md) há 28 gravadoras ativas e 584.224 pares, dos quais 34 têm as nove casas preenchidas e 30 admitem nove respostas distintas. Ali cada seleção levou de 1,5 a 1,8 s e 167 MiB de pico no `tracemalloc`, quase tudo para montar pares que nunca formariam uma grade.

## Decisão

### Pares com as nove casas preenchidas, em blocos

Um par curado só forma grade se cada critério da linha divide algum grupo com cada critério da coluna. Como uma categoria nunca aparece nos dois eixos, as gravadoras de um par ficam todas do mesmo lado. O gerador fixa primeiro os critérios de década e de integrantes de cada partição (`_curated_pair_blocks`). Para cada escolha válida desses critérios ele guarda, em ordem de id, as gravadoras cujos grupos encontram todos os critérios do outro eixo. Cada subconjunto do tamanho certo dessas gravadoras completa um par com as nove casas preenchidas. O bloco guarda só essa lista, e cada sorteio monta um subconjunto pela posição.

As listas fixas limitam o número de blocos. Com as 4 décadas e as 12 contagens de integrantes ativas e todas compatíveis entre si, são 3.386. Montar os blocos custa esse número vezes o número de gravadoras. Os pares contidos nos blocos são exatamente os pares da listagem antiga com as nove casas preenchidas, cada um uma vez. Um teste compara as duas enumerações num catálogo sorteado.

### Ordem preguiçosa determinística

`shuffled_blocks`, em `kpop_scraping/lazy_order.py`, sorteia as posições de todos os blocos postos em sequência com o Fisher-Yates da [ADR 035](035-busca-preguicosa-da-connections.md), que guarda só as posições trocadas. Cada posição vira um par pelo sistema numérico combinatório (`combination_at`). Todo par curado com as nove casas preenchidas tem a mesma chance em cada sorteio, como na lista embaralhada de antes, então cada par resolvível continua com a mesma chance de ser o escolhido. `combination_at` agora acha cada elemento por busca binária, com O(k log n) binômios; a saída é a mesma, e a Connections gera os mesmos tabuleiros.

Pular um par por causa dos vizinhos gasta o mesmo sorteio que testá-lo. A ordem não depende do conjunto evitado, e uma data par ou uma data ímpar sem conflito recebe o que a semente sozinha sorteia, como pede a ADR 008.

O fallback de eixos mistos sorteia as triplas de linha com `shuffled_combinations` e acha as colunas compatíveis pela interseção de três conjuntos de critérios vizinhos, calculados uma vez por seleção a partir dos grupos. Ele embaralha as colunas de cada linha com um gerador próprio, também derivado da semente.

A ordem depende só do `random.Random` semeado com o SHA-256 da semente e das listas ordenadas de ids. Nenhum passo lê a ordem de `set` ou `dict` de strings, e a mesma data gera a mesma grade em processos com `PYTHONHASHSEED` diferentes.

### Orçamento

Um passo é um par curado sorteado, uma tripla de linha sorteada pelo fallback ou uma tripla de colunas testada por ele. Cada seleção de eixos tem 20.000 passos (`MAX_AXIS_SEARCH_STEPS`), compartilhados pela busca curada e pelo fallback. Ao esgotá-los, a seleção levanta `ValueError` com a semente, o limite e os passos gastos de cada tipo. `generate_daily_grid` deixa o erro subir, inclusive quando ele vem do sorteio de um vizinho, e o runner o trata como qualquer falha da Grade. Ele mantém a grade da véspera com o aviso `Daily grid not updated` ou publica o dia sem Grade.

Na cópia com os anos da ADR 029, as sementes diárias de 365 datas a partir de 2026-11-15 gastaram de 1 a 4 passos por seleção. Uma seleção que evita todos os conjuntos resolvíveis percorre a busca curada e o fallback inteiros e gastou 8.518 passos, quase todos em triplas de linha do fallback. No banco local, que tem um só conjunto resolvível, as datas pares gastaram 1 passo e as ímpares percorreram tudo em 973. Com 100 gravadoras de 3 grupos e os 12 critérios de integrantes, o orçamento termina a seleção em cerca de 0,4 s quando os grupos das gravadoras não encontram nenhum outro critério e em cerca de 0,5 s quando todos os critérios têm os mesmos 3 grupos, com menos de 4 MiB de pico.

### Grades publicadas

A ordem nova gera outras grades para as mesmas datas. O dia já servido, no diretório principal ou promovido de `next/`, mantém a grade, e a revalidação de elegibilidade da ADR 008 segue valendo. A grade de D+1 em `next/`, que o runner refaz a cada execução, sai na ordem nova, assim como uma data gerada de novo com `--regenerate` ou substituída pela revalidação.

## Alternativas consideradas

### Sortear pares de todo o produto cruzado, sem os blocos

Sortear de forma preguiçosa todos os pares das 18 partições, com orçamento, dispensaria a lista. O custo de procurar continuaria. Na cópia com os anos da ADR 029, 34 de 584.224 pares têm as nove casas preenchidas. A busca precisaria, em média, de cerca de 19 mil sorteios por data, a razão entre os 584.224 pares e os 30 resolvíveis, e ainda falharia por azar em algumas sementes. Um orçamento que cobrisse isso deixaria o caso de 100 gravadoras em vários segundos por seleção.

### Sortear o eixo de linhas e depois as colunas compatíveis

É o que o fallback faz. Muda a chance de cada par, porque um eixo de linhas com poucas colunas compatíveis teria o mesmo peso de um eixo com muitas, e a busca curada percorreria milhares de linhas sem coluna nenhuma antes de achar uma grade.

### Limitar o número de gravadoras

Cortar as gravadoras ativas limitaria a lista. O corte tiraria do sorteio critérios com evidência e exigiria escolher quais ficam. Um corte pela ordem dos ids enviesaria a grade para os QIDs menores.

## Consequências

- O tempo e a memória da seleção acompanham os pares e as linhas sorteados. A montagem dos blocos cresce com o número de gravadoras, sem o cubo.
- Um catálogo em que nenhuma seleção acha grade em 20.000 passos faz a Grade do dia falhar com `ValueError`, como já acontecia com "Unable to generate a solvable 3x3 intersection grid". Num catálogo sem grade, ou em que todas repetem os vizinhos, o fallback percorre todas as triplas de linha. A partir de 51 critérios ativos elas passam de 20.000 (C(51, 3) = 20.825), e o erro é o do orçamento em vez da mensagem de cobertura ou de vizinhos.
- O fallback só acha grades que a busca curada também acha, porque as 18 partições cobrem todas as composições de categorias que ele aceita. Em 400 catálogos sorteados, 242 sem grade curada, ele não achou nenhuma. Ele continua no código porque removê-lo muda mais do que esta decisão pede. Roda depois da busca curada e consome o resto do orçamento. Removê-lo não perde nenhuma grade e deixaria a mensagem de cobertura ou de vizinhos nos catálogos sem grade, o que fica como decisão em aberto.
- Quando o sorteio de um vizinho esgota o orçamento, `generate_daily_grid` deixa o erro subir. A alternativa é tratá-lo como um vizinho sem grade, o que publicaria uma grade que talvez repita os critérios de um vizinho que a busca não terminou de avaliar. A escolha conservadora evita essa repetição. A probabilidade hoje é próxima de zero, porque as sementes de 365 datas gastaram de 1 a 4 passos por seleção.
- `MAX_AXIS_SEARCH_STEPS` fica em `kpop_scraping/grid_generator.py`. Mudá-lo pode mudar a grade das datas perto do limite.
