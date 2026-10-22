# Gerador offline de Cruzadinha diária

`crossword-daily-v1` é independente de `crossword-pilot-v1`. O tabuleiro fixo
publicado continua em uso. O novo gerador não chama rede, migra banco, publica
arquivos web nem atualiza manifest. Regras e plano de integração estão na
[ADR 024](decisions/024-cruzadinha-diaria-e-unicidade.md).

## CLI

O caminho do banco deve ser absoluto. A leitura usa uma transação SQLite com
`mode=ro` e `query_only=ON`. Exemplos a partir da raiz:

```bash
python -m kpop_scraping.crossword_daily_cli \
  --database /caminho/absoluto/kpop.db \
  --reference-date 2026-10-21 --seed daily-v1 --bootstrap \
  --output .scratch/crossword/2026-10-21.json

python -m kpop_scraping.crossword_daily_cli \
  --database /caminho/absoluto/kpop.db \
  --reference-date 2026-10-22 --seed daily-v1 \
  --previous-artifact .scratch/crossword/2026-10-21.json \
  --output .scratch/crossword/2026-10-22.json

python -m kpop_scraping.crossword_daily_cli \
  --database /caminho/absoluto/kpop.db \
  --verify .scratch/crossword/2026-10-22.json
```

`--previous-context contexto.json` aceita uma declaração explícita como
`{"state":"played","date":"2026-10-21","qids":["Q1","Q2","Q3"]}`.
Esses QIDs ilustram o formato; o chamador fornece os QIDs realmente publicados.
Uma omissão confirmada usa `{"state":"omitted","date":"2026-10-21","qids":[]}`.
Histórico ausente é erro, não uma lista vazia. `--bootstrap` declara a primeira
partida e deve ser usado somente nessa situação. A data do contexto precisa ser
a véspera exata, exceto no bootstrap, que identifica a data inicial.

A verificação exige a mesma base factual. Se a base mudou entre dias, um registro
explícito dos QIDs efetivamente jogados permite continuar sem reutilizar fatos
antigos. Um artefato antigo não é validado contra uma base diferente por checksum
apenas. Erros de entrada retornam código 1 e preservam a saída existente. Uma
omissão válida retorna 0 e grava o envelope `status: omitted`, `puzzle: null`,
com a contagem de tentativas rejeitadas.

## API

`load_base(Path(...))` lê o universo factual. `generate(base, data, seed,
contexto, limits=None)` retorna o envelope, e `validate(envelope, base)` recalcula
as correspondências e a prova. `next_context(envelope, base)` valida uma saída e
produz o contexto da próxima data. As funções não escrevem arquivos nem fazem
coleta. A identidade inclui grupos, aliases, índice factual completo dos
predicados suportados e fontes publicáveis com revisões/localizadores/trechos.
A ordenação ignora a ordem física de inserção no SQLite.

A geração usa pistas de integrante documentado ou formação + gravadora
documentada. Não afirma vínculo atual. Todas as correspondências são calculadas
contra o universo inteiro; o corte de até nove caracteres vem depois. A prova
aceita uma única atribuição de respostas aos slots e pistas fixados, sem exigir
um único layout possível. Ver a ADR para as limitações epistemológicas.

## Benchmark sequencial

```bash
python -m kpop_scraping.crossword_daily_cli \
  --database /caminho/absoluto/kpop.db \
  --reference-date 2026-10-21 --seed daily-v1 --bootstrap \
  --benchmark-days 366 --benchmark-dir .scratch/crossword/benchmark
```

As 366 datas incluem 2026-10-21 e 2027-10-21. Cada saída validada fornece o
contexto da seguinte, inclusive em omissões. O benchmark verifica interseções
vazias entre dias consecutivos e registra por dia prova, grupos, tempo,
tentativas e rejeições. `benchmark.json` separa rejeição por tentativa de falha
por dia e inclui hashes do banco antes/depois. Saídas operacionais devem ficar
em `.scratch/`, fora do Git. `--attempts`, `--placement-nodes` e `--proof-nodes`
controlam limites determinísticos; os padrões são 200, 5.000 e 10.000.

A busca é gulosa com reinícios aleatórios determinísticos. Esgotar as tentativas
não prova impossibilidade matemática de construir uma grade. Não há fallback
para o piloto nem relaxamento de evidência ou de exclusão da véspera.

A [medição inicial de 366 datas](crossword-daily-benchmark.md) registra os resultados
observados e as limitações da base e da seed usadas.
