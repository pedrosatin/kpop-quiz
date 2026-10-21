# Benchmark do gerador Strands

Medição histórica de 2026-10-21 que orientou a grade padrão do gerador em 9×9. Os números vêm de uma cópia de `data/kpop.db` desse dia, num laptop, com Python 3 sem dependências externas:

```bash
python -m kpop_scraping.strands_benchmark --database data/kpop.db --samples 10 --theme-seeds 5
```

A medição usou os limites padrão da época: 60 tentativas de layout por lista de palavras, 4000 nós de busca por tentativa e 6 orientações de letras por layout. A etapa com listas sintéticas chama o solver sem deadline. A geração de temas reais usou prazo de 30 s por execução.

Os números abaixo não foram reexecutados após a correção dos limites de busca. O gerador agora limita também a prova de unicidade a 100000 nós por enumeração, compartilhados entre prefixos e combinações de trilhas, e verifica o prazo durante as buscas e antes de devolver o artefato. Exceder esse orçamento interrompe a geração com falha explícita, sem conclusão sobre unicidade. O prazo é cooperativo: operações externas, como leituras SQLite, são verificadas antes e depois, sem cancelamento durante a chamada.

## Como o gerador funciona

1. Tema: `build_strands_themes` reaproveita `extract_viable_themes` do caça-palavras e mantém só elencos e as décadas de formação 1990, 2000 e 2010. O elenco inclui integrantes atuais e antigos documentados, como Jessica em Girls' Generation, quando há evidência válida de integração. Usa o nome do grupo como spangram `entity`, com a evidência dos fatos de integração. A década usa um spangram `theme` fixo em grafia pt-BR (`ANOSNOVENTA`, `ANOSDOISMIL`, `ANOSDOISMILEDEZ`). Um subconjunto de 5 a 8 palavras é sorteado para que as letras, somadas às do spangram, deem exatamente `linhas × colunas`. Nenhuma palavra escolhida pode conter outra nem o spangram.
2. Layout: o solver trabalha só com comprimentos. O spangram sai de um lado da grade e precisa tocar o lado oposto. Cada palavra seguinte cresce a partir da célula vazia com menos vizinhos vazios, preferindo vizinhos também restritos. Depois de cada trilha, as regiões vazias precisam ser divisíveis entre os comprimentos que faltam; um passo que deixa uma célula vazia sem saída é podado na hora. Passos diagonais que cruzariam outro passo diagonal no mesmo quadrado 2×2 nunca são dados.
3. Letras e unicidade: as palavras são escritas ao longo das trilhas, em sentido sorteado. O enumerador acha todas as trilhas de cada palavra com poda por prefixo e conta as escolhas de uma trilha por palavra sem células repetidas. A grade só é aceita quando essa contagem é 1.

O sorteio usa `random.Random` semeado com o SHA-256 da seed. O esforço é limitado por contagem de nós, de modo que a mesma base, seed, data e dimensões produzem o mesmo arquivo em qualquer máquina. O tempo total só serve de trava para o CI: ao estourar, o gerador lança `StrandsGenerationError` em vez de devolver outra grade.

### Definição de unicidade

Dado o conjunto de palavras do puzzle, spangram incluído, existe exatamente uma atribuição de uma trilha por palavra com trilhas disjuntas. Como as letras somam a área da grade, trilhas disjuntas cobrem a grade inteira. A contagem é estrita:

- duas atribuições que diferem só na ordem das células de uma palavra contam como soluções diferentes;
- uma alternativa que cruza diagonais em X também conta, porque o jogador poderia traçá-la;
- uma palavra com mais de 2000 trilhas na grade reprova a grade sem prova;
- atingir o orçamento de nós ou o prazo interrompe a busca sem provar unicidade nem inexistência de solução.

Palavras fora do tema ficam fora da prova. A grade pode formar outros nomes ou palavras de dicionário, e o jogo deve aceitar apenas as palavras do tema, na trilha publicada. `verify_strands_uniqueness` refaz a prova a partir do JSON publicado e confere que a solução única é a declarada em `cells`.

### Nomes descartados

Cada descarte fica registrado com motivo em `python -m kpop_scraping.strands_cli --list-themes`:

- `short_name`: o nome normalizado tem menos de 3 letras (`RM`, `I.N`, `2PM`);
- `non_latin_name`: o nome tem letra fora do alfabeto latino (Hangul, kana, CJK). O nome não é truncado, porque a grade mostraria outra grafia;
- `no_evidence`, `duplicate_word`: sem evidência auditada ou com a mesma palavra de outro integrante;
- `overlaps_spangram`: a palavra está contida no spangram ou o contém.

## Solver com listas sintéticas de 6 a 9 palavras

Listas sintéticas sorteadas a partir dos 408 nomes reais normalizados da base, incluindo integrantes, grupos e spangrams, com letras somando a área da grade. Cada lista pode misturar temas e mede apenas o solver, sem demonstrar diversidade de temas publicáveis. "Listas" conta as amostras encontradas pela busca limitada: zero significa que ela não encontrou uma lista, sem provar inexistência. Os percentuais de fechamento valem somente para as amostras medidas.

O relatório atual em Markdown acrescenta a coluna "Listas com unicidade não provada", que conta amostras interrompidas por `UniquenessBudgetExceeded`. O benchmark continua nas demais amostras e inclui o tempo e as tentativas já consumidos no cálculo de ms/tentativa. A interrupção não soma ambiguidade nem grade fechada; ambiguidades já comprovadas na amostra permanecem na contagem. Outras exceções propagam. O comando não emite JSON. A tabela histórica abaixo permanece sem a nova coluna, pois a medição não foi repetida e não produziu essa contagem.

| Grade | Palavras | Listas | Fechadas | Tentativas com layout | ms/tentativa | s/grade fechada (mediana / máx.) | Layouts ambíguos |
|---|---|---|---|---|---|---|---|
| 9×9 | 6 | 0 | sem amostra | sem amostra | sem amostra | sem amostra | sem amostra |
| 9×9 | 7 | 7 | 7 (100%) | 10/66 (15%) | 54 | 0.29 / 1.10 | 24/31 |
| 9×9 | 8 | 10 | 10 (100%) | 25/110 (23%) | 43 | 0.38 / 1.15 | 104/114 |
| 9×9 | 9 | 10 | 10 (100%) | 22/89 (25%) | 38 | 0.21 / 0.89 | 88/98 |
| 9×10 | 6 | 0 | sem amostra | sem amostra | sem amostra | sem amostra | sem amostra |
| 9×10 | 7 | 0 | sem amostra | sem amostra | sem amostra | sem amostra | sem amostra |
| 9×10 | 8 | 7 | 7 (100%) | 13/79 (16%) | 54 | 0.59 / 1.11 | 50/57 |
| 9×10 | 9 | 10 | 9 (90%) | 34/138 (25%) | 48 | 0.10 / 1.35 | 167/176 |
| 10×10 | 6 | 0 | sem amostra | sem amostra | sem amostra | sem amostra | sem amostra |
| 10×10 | 7 | 0 | sem amostra | sem amostra | sem amostra | sem amostra | sem amostra |
| 10×10 | 8 | 0 | sem amostra | sem amostra | sem amostra | sem amostra | sem amostra |
| 10×10 | 9 | 5 | 4 (80%) | 13/101 (13%) | 56 | 0.42 / 0.98 | 63/67 |

Nas amostras medidas, uma tentativa encontrou layout em 13% a 25% dos casos e custou de 38 a 56 ms. A maior parte dos layouts sai ambígua na primeira orientação, em geral por letras repetidas vizinhas (`OO`, `YOUNG`) que admitem outra ordem de células; o gerador sorteia outra orientação ou outro layout.

## Orçamento de letras dos temas reais

Para cobrir a grade, as letras do tema precisam somar exatamente a área com no máximo 9 palavras, e o spangram precisa ter ao menos tantas letras quanto o menor lado. As grades abaixo de 9×9 ficam fora do contrato `strands-puzzle-v1` e entram aqui só como referência.

| Grade | Elencos que cabem | Décadas que cabem | Motivos (elencos) |
|---|---|---|---|
| 9×9 | 1/52 | 1/3 | group_short_name 2, not_enough_letters 11, spangram_too_short 38 |
| 9×10 | 0/52 | 1/3 | group_short_name 2, not_enough_letters 12, spangram_too_short 38 |
| 10×10 | 0/52 | 1/3 | group_short_name 2, not_enough_letters 9, spangram_too_short 41 |
| 6×8 | 7/52 | 3/3 | group_short_name 2, no_exact_letter_count 12, not_enough_letters 14, spangram_too_short 17 |
| 7×7 | 9/52 | 3/3 | group_short_name 2, no_exact_letter_count 10, not_enough_letters 12, spangram_too_short 19 |
| 7×8 | 3/52 | 3/3 | group_short_name 2, no_exact_letter_count 7, not_enough_letters 21, spangram_too_short 19 |
| 8×8 | 2/52 | 3/3 | group_short_name 2, no_exact_letter_count 2, not_enough_letters 15, spangram_too_short 31 |

Girls' Generation soma 71 letras nos oito nomes de integrantes normalizados e 15 no spangram GIRLSGENERATION, totalizando 86. Excluir SUNNY, de 5 letras, deixa 81 letras em sete integrantes mais o spangram, oito palavras ao todo. Ateez soma 88 letras com o spangram, cujo nome curto impede ligar lados opostos da grade. Esses exemplos não estabelecem qual é o maior elenco da base. Na medição, 38 elencos têm nome de grupo com menos de 9 letras. Na faixa de 9 a 10 por lado do contrato, a análise de letras encontrou Girls' Generation elegível em 9×9 e a década de 2010 nos três tamanhos; as décadas de 1990 e 2000 têm poucas letras.

## Temas reais de ponta a ponta

| Grade | Tema | Sementes | Fechadas | s/grade (mediana / máx.) |
|---|---|---|---|---|
| 9×9 | 2010s Groups | 5 | 5 | 1.46 / 6.85 |
| 9×9 | Members of Girls' Generation | 5 | 5 | 1.62 / 4.04 |
| 9×10 | 2010s Groups | 5 | 2 | 0.96 / 1.07 |
| 10×10 | 2010s Groups | 5 | 0 | sem grade fechada |

A CLI gerou e verificou (schema e unicidade) os dias 2026-11-01 a 2026-11-12 com a seed diária padrão: 12 de 12 puzzles válidos, de 1,1 s a 3,8 s por dia, incluindo a carga da base.

## Decisão

A entrega inclui o gerador, e a estreia fica adiada até ampliar os temas disponíveis. O contrato, o pipeline e a aplicação web permanecem como estavam.

A grade padrão fica em 9×9. É o único tamanho do contrato em que um elenco cabe, fechou todas as listas sintéticas amostradas de 7 a 9 palavras e os dois temas reais nas cinco sementes medidas de cada um. Em 10×10 a década de 2010 não fechou em nenhuma das 5 sementes, porque precisa de 85 letras em 8 palavras e quase só sobram nomes de 9 e 10 letras.

## Limites conhecidos

- Na base medida, há somente dois temas elegíveis em 9×9. O gerador embaralha os temas por seed e pode repetir o mesmo em dias consecutivos; não há alternância garantida. Girls' Generation usa o mesmo subconjunto de palavras, com layouts dependentes da seed. O contrato permanece em 9 a 10 por lado, 6 a 9 palavras totais incluindo o spangram, temas de elencos e décadas e unicidade estrita.
- A década de 2010 escolhe com frequência os nomes mais longos (`SMTHEPERFORMANCE`), porque precisa de 66 letras em até 8 palavras.
- Nomes de subunidades aparecem como vêm da base (`INFINITEH`, `FVEDOLLS`).
- O spangram de década usa a grafia pt-BR também para quem joga em inglês.
