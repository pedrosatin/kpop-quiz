# Arquitetura

## Fluxo alvo

```text
MediaWiki e Wikidata
        |
        v
descoberta e catálogo de páginas
        |
        v
snapshots por revisão
        |
        v
extração versionada
        |
        v
entidades e afirmações
        |
        v
validação e revisão
        |
        v
perguntas versionadas
        |
        v
API somente leitura ou JSON estático
        |
        v
webpage de quizzes
```

Cada etapa recebe e produz um contrato persistido. Uma correção no extrator pode reprocessar snapshots existentes sem repetir a consulta externa. Uma nova revisão invalida somente afirmações e perguntas dependentes daquela fonte.

## Estado entregue

O código implementa descoberta, obtenção do resumo, histórico de revisões, classificação do catálogo, extração de fatos do Wikidata e geração de quizzes. A Action API da Wikipedia fornece paginação, `pageid`, URL canônica, `revid`, QID e marcas da página. A CLI de coleta coordena as etapas e exporta dois CSVs. A CLI de quiz lê o banco e exporta JSON estático. O repositório SQLite usa parâmetros, `UPSERT` e migrações transacionais.

A etapa de fatos separa os módulos por responsabilidade:

| Módulo | Responsabilidade |
| --- | --- |
| `mediawiki.py` | HTTP, timeout, `User-Agent`, `maxlag`, repetição e `Retry-After` |
| `wikidata.py` | lotes de `wbgetentities`, perfis de requisição, ausências e redirecionamentos |
| `entities.py` | extração e normalização de nomes, afirmações, qualificadores, referências e datas |
| `facts.py` | mapeamento de propriedades para predicados de grupo e pessoa |
| `evidence.py` | referências suficientes e busca no resumo da Wikipedia |
| `validation.py` | rank, valor, duplicata, conflito, período de vínculo e evidência |
| `fact_store.py` | snapshots de entidades, entidades, aliases, fatos e evidências no SQLite |
| `fact_pipeline.py` | ordem das consultas e transação da execução |
| `reports.py` | CSV de cobertura por grupo e predicado |
| `quiz_templates.py` | textos versionados em PT-BR e inglês |
| `quiz_models.py` | tipos e versões usados pelo gerador |
| `quiz_repository.py` | leitura de entidades, fatos e evidências do SQLite e versão do dataset |
| `quiz_drafts.py` | seleção de fatos e criação de alternativas sem idioma |
| `quiz_rendering.py` | renderização das perguntas em PT-BR e inglês |
| `quiz_session.py` | filtros e seleção determinística das dez perguntas da sessão |
| `quiz_generator.py` | fachada pública e montagem do dataset e do relatório |
| `quiz_schema.py` | validação dos contratos e escrita atômica |
| `quiz_cli.py` | exportação do dataset, relatório e sessão |

`entities.py`, `facts.py`, `evidence.py`, `validation.py` e o núcleo do gerador operam sobre JSON e dataclasses sem rede. Os testes usam fixtures reduzidas de respostas reais. Uma execução de fatos grava tudo em uma transação. Uma falha desfaz entidades e fatos da execução e marca `fact_runs.status` como `failed`. Snapshots gravados antes da falha podem ficar sem linha no banco, como na coleta da Wikipedia, e a execução seguinte confere o hash antes de reutilizá-los.

O gerador consulta fatos e evidências sem gravar no SQLite. Ele valida o dataset antes de criar o arquivo temporário. A versão do dataset deriva do conteúdo, dos templates, da data de referência e das versões das regras. Cada pergunta registra a base factual e uma identidade semântica. A sessão aplica filtros sobre o dataset, rejeita identidades semânticas repetidas e usa a semente somente para selecionar perguntas e ordenar alternativas.

## Componentes previstos

`source adapters` consultam cada provedor e preservam seus identificadores. `extractors` transformam respostas brutas em candidatos a afirmação. `normalizers` resolvem tipos, datas, aliases e unidades. `validators` detectam ausência de evidência, conflitos e precisão insuficiente. `question generators` aplicam templates determinísticos. A aplicação web consome somente perguntas aceitas.

## Persistência

SQLite atende o desenvolvimento local, jobs com um escritor e leitura da aplicação. Uma migração para PostgreSQL só deve ocorrer se o sistema precisar de gravações concorrentes, edição simultânea ou hospedagem que não ofereça disco persistente.

Snapshots comprimidos ficam em `<raw-dir>/<provedor>/<idioma>/<pageid>/<revid>.json.gz`. Entidades do Wikidata ficam em `<raw-dir>/wikidata/<perfil>/<QID>/<lastrevid>.json.gz`. O banco armazena o caminho relativo, o SHA-256 do JSON canônico descomprimido e a data da coleta. A CLI aceita `--raw-dir`; sem esse argumento, usa a pasta `raw` ao lado do banco. Arquivos brutos não entram no Git.

O coletor reutiliza um snapshot quando encontra a mesma revisão e o mesmo hash. Conteúdo diferente com o mesmo `revid` causa falha de integridade. A gravação usa um arquivo temporário, sincroniza os bytes e faz a troca atômica no caminho final.

## Fronteiras

- Descoberta retorna candidatos. Ela não declara que toda página é um grupo.
- O catálogo valida somente o tipo da página. Ele não extrai fatos do grupo.
- A extração de fatos lê somente grupos aceitos pelo catálogo e revisões já coletadas da Wikipedia.
- Extração produz fatos aceitos e fatos retidos para auditoria. O gerador publica somente os aceitos que atendem ao template.
- Validação decide se uma afirmação atende às regras do template.
- A webpage não consulta Wikipedia durante uma partida.
- LLMs podem sugerir mapeamentos ou textos. Regras determinísticas e evidência decidem a publicação.
