# K-pop quiz data

Coletor e base de dados para quizzes verificáveis sobre grupos e artistas de K-pop. O projeto consulta as APIs da Wikipedia e do Wikidata, registra as revisões consultadas no SQLite e preserva as respostas das páginas e entidades em JSON comprimido.

O estado atual cobre descoberta de páginas, resumos, classificação de candidatos e extração de fatos do Wikidata para grupos aceitos e integrantes. Também há um catálogo auditável de candidatos a lançamentos musicais. O catálogo rejeita listas, desambiguações, redirecionamentos e QIDs sem um tipo musical aceito. Cada fato aceito aponta para uma referência do Wikidata ou para um trecho de revisão da Wikipedia.

## Requisitos

- Python 3.11 ou mais recente
- Node.js 22 ou mais recente para a interface web
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
python main.py --limit 45 --database /tmp/kpop.db --releases --release-group-limit 10 --release-report /tmp/kpop-releases.csv
python main.py --limit 60 --database /tmp/kpop.db --releases --release-group-limit 25 --release-group-offset 25
python -m kpop_scraping.quiz_cli --database /tmp/kpop.db --output /tmp/questions.json --report /tmp/quiz-report.json --session-output /tmp/session.json --seed rodada-1 --timer-seconds 20
python -m kpop_scraping.web_publish --database /tmp/kpop.db --output-dir web/public/data --seed web-launch-v1 --timer-seconds 20
python -m kpop_scraping.web_publish --output-dir web/public/data --verify
python -m unittest discover -v
python -m compileall -q .
```

## Interface web

A interface estática usa Astro e Preact. O build cria as rotas `/pt-br/` e `/en/` sob o caminho `/kpop-scraping/` do GitHub Pages. O navegador valida o manifesto, o SHA-256 e o contrato da sessão antes de iniciar o quiz.

```bash
cd web
npm ci
npm test
npm run build
```

O comando `web_publish` gera uma sessão de dez perguntas para cada idioma. Os arquivos ficam em `web/public/data`. Cada nome de sessão inclui seu SHA-256, e o publicador troca o manifesto somente depois de gravar as duas sessões. O workflow do GitHub Pages verifica esses artefatos antes do build.

Uma nova execução atualiza cada página pela combinação de provedor, idioma e `pageid`. `collection_runs` registra sucesso ou falha. `source_pages` guarda o estado mais recente, `source_revisions` aponta para cada snapshot e seu SHA-256, e `collection_run_revisions` registra as revisões usadas em cada execução. `catalog_entries` guarda uma decisão por página. Uma revisão nova ou uma mudança nos metadados usados pelo classificador devolve a página ao estado `candidate`.

A etapa de fatos roda com `--facts`, `--facts-limit` ou `--facts-report`. Ela grava entidades, aliases, fatos e evidências. O CSV de cobertura mostra, por grupo e predicado, quantos fatos foram aceitos, rejeitados, substituídos ou ficaram em conflito. Sem `--facts-report`, o arquivo `facts-coverage.csv` fica ao lado do banco. Repetir a etapa atualiza cada fato pelo ID da afirmação do Wikidata.

`--releases` usa o WDQS somente para descobrir candidatos. A consulta e a resposta ficam em snapshots com SHA-256. Cada QID é buscado de novo por `wbgetentities`; classe, artista, data e gênero são confirmados nesse snapshot direto. O pipeline consulta os sitelinks `enwiki`, `ptwiki` e `kowiki`, resolve o título pela API de cada wiki e grava a revisão do verbete. `performed_by` e `released_on` só entram no conjunto aceito quando uma referência aprovada do Wikidata ou o texto dessa revisão confirma a relação. Páginas ausentes, listas, desambiguações e páginas ligadas a outro QID ficam registradas em `release_source_pages`. O limite padrão é de 25 grupos por consulta e 100 candidatos por grupo.

`python -m kpop_scraping.quiz_cli` lê o banco sem executar coleta. O comando grava um dataset bilíngue e um relatório em JSON canônico. `--session-output` também grava uma sessão de dez perguntas. Os filtros `--session-language`, `--theme`, `--group` e `--difficulty` podem ser combinados. `--timer-seconds` registra o limite na configuração da sessão.

Os arquivos `schemas/quiz-dataset-v1.json` e `schemas/quiz-session-v1.json` descrevem os contratos públicos. Cada pergunta mantém os IDs dos fatos e as evidências usadas para gerá-la. A mesma entrada, versão e semente produzem bytes idênticos.

O coletor aplica migrações pendentes ao abrir o banco. Cada migração roda em uma transação. Bancos criados pela versão anterior mantêm execuções e páginas durante a migração.

## Estrutura

```text
kpop_scraping/   cliente, fluxo, CLI e persistência
schemas/          contratos JSON dos datasets e sessões
tests/           testes unitários e fixtures
web/             interface estática e sessões publicadas
```

## Licenças e proveniência

Só use fontes cuja licença, atribuição e limites de uso tenham sido revisados. Cada dado publicável deve conservar a origem e a evidência que sustentam a afirmação. Arquivos brutos, bancos SQLite e CSVs locais não entram no Git.
