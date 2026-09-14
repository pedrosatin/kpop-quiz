# K-pop quiz data

Coletor e base de dados para quizzes verificáveis sobre grupos e artistas de K-pop. O projeto consulta as APIs da Wikipedia e do Wikidata, registra as revisões consultadas no SQLite e preserva as respostas das páginas e entidades em JSON comprimido.

O estado atual cobre descoberta de páginas, resumos, classificação de candidatos e extração de fatos do Wikidata para grupos aceitos e integrantes. O catálogo rejeita listas, desambiguações, redirecionamentos e QIDs sem um tipo musical aceito. Cada fato aceito aponta para uma referência do Wikidata ou para um trecho de revisão da Wikipedia.

## Requisitos

- Python 3.11 ou mais recente
- acesso à internet para executar a coleta

O coletor usa somente a biblioteca padrão do Python.

## Início rápido

```bash
python3 -m venv .venv
source .venv/bin/activate
python main.py --limit 10
```

O comando cria `data/kpop.db`, grava snapshots em `data/raw` e exporta `data/catalog-report.csv`. Retire `--limit 10` para percorrer toda a categoria.

O diretório de snapshots pode ficar fora da pasta do banco:

```bash
python main.py --limit 10 --database /tmp/kpop.db --raw-dir /tmp/kpop-raw
```

Use um identificador próprio em execuções recorrentes:

```bash
python main.py --user-agent "kpop-quiz/0.1 (https://seu-site.example/contato)"
```

## Comandos

```bash
python main.py --help
python main.py --limit 3 --database /tmp/kpop-quiz.db
python main.py --limit 3 --catalog-report /tmp/kpop-catalog.csv
python main.py --limit 45 --database /tmp/kpop.db --facts-limit 30 --facts-report /tmp/kpop-facts.csv
python -m unittest discover -v
python -m compileall -q .
```

Uma nova execução atualiza cada página pela combinação de provedor, idioma e `pageid`. `collection_runs` registra sucesso ou falha. `source_pages` guarda o estado mais recente, `source_revisions` aponta para cada snapshot e seu SHA-256, e `collection_run_revisions` registra as revisões usadas em cada execução. `catalog_entries` guarda uma decisão por página. Uma revisão nova ou uma mudança nos metadados usados pelo classificador devolve a página ao estado `candidate`.

A etapa de fatos roda com `--facts`, `--facts-limit` ou `--facts-report`. Ela grava entidades, aliases, fatos e evidências. O CSV de cobertura mostra, por grupo e predicado, quantos fatos foram aceitos, rejeitados, substituídos ou ficaram em conflito. Sem `--facts-report`, o arquivo `facts-coverage.csv` fica ao lado do banco. Repetir a etapa atualiza cada fato pelo ID da afirmação do Wikidata.

O coletor aplica migrações pendentes ao abrir o banco. Cada migração roda em uma transação. Bancos criados pela versão anterior mantêm execuções e páginas durante a migração.

## Estrutura

```text
kpop_scraping/   cliente, fluxo, CLI e persistência
tests/           testes unitários e fixtures
```

## Licenças e proveniência

Só use fontes cuja licença, atribuição e limites de uso tenham sido revisados. Cada dado publicável deve conservar a origem e a evidência que sustentam a afirmação. Arquivos brutos, bancos SQLite e CSVs locais não entram no Git.
