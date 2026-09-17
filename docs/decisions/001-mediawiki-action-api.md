# ADR 001 sobre descoberta pela MediaWiki Action API

## Status

Aceito em 2026-09-12.

## Contexto

O protótipo lia o HTML da categoria com classes CSS e texto do link de paginação. A página atual contém subcategorias antes da lista de grupos, e o primeiro link com o título da categoria pode ser "previous page". O script coletava itens errados e encerrava a paginação antes do fim.

O sistema precisa de identidade estável, paginação verificável, revisão da fonte e política de acesso compatível com a Wikimedia.

## Decisão

Usar a Action API. `categorymembers` descobre páginas por `pageid` e `cmcontinue`. `info`, `revisions` e `extracts` obtêm URL canônica, `revid` e resumo. O cliente define timeout, repetição limitada, `User-Agent` e `maxlag`.

## Alternativas consideradas

### Continuar lendo HTML

Preservaria BeautifulSoup e parte do protótipo. Classes, ordem dos blocos e rótulos de navegação não formam um contrato estável. A alternativa foi rejeitada para descoberta.

### Usar apenas Wikidata

Wikidata oferece identificadores e fatos estruturados. Sua cobertura e modelagem não substituem o texto e as tabelas usados como evidência editorial. Ele será um adaptador complementar.

## Consequências

- O coletor não depende da apresentação HTML da categoria.
- `pageid` substitui IDs sequenciais.
- O token oficial controla a paginação.
- A revisão usada entra no banco.
- A categoria ainda precisa de classificação, pois pode incluir listas ou páginas fora do domínio.
