# ADR 020. Página 404 e sitemap com lastmod e hreflang

## Status

Aceita

## Data

2026-10-04

## Contexto

O build não gerava `404.html`. Sem esse arquivo, o Cloudflare Pages trata o site como SPA e responde qualquer caminho inexistente (por exemplo `/nao-existe-xyz` ou `/sitemap-index.xml`) com HTTP 200 e o HTML da raiz, que tem canonical para `/pt-br/`. O Search Console classifica essas respostas como soft 404.

O `sitemap.xml` da [ADR 018](018-seo-llm-indexing.md) listava só `<loc>`, sem `<lastmod>` nem alternates de idioma.

## Decisão

`web/src/pages/404.astro` gera `dist/404.html`. Com esse arquivo na raiz, o Cloudflare Pages serve a página com HTTP 404 para rotas desconhecidas, e o GitHub Pages da homologação faz o mesmo. A página usa o `BaseLayout` sem `canonicalPath`: nesse caso o layout não emite canonical, hreflang, `og:url` nem JSON-LD. Ela é sempre `noindex`, tem texto em português e em inglês e lista os sete jogos nos dois idiomas, respeitando o `base` da homologação.

O sitemap continua sendo o endpoint `sitemap.xml.ts`, agora montado por `web/src/lib/sitemap.ts`. Cada URL recebe:

- `<lastmod>` com a data do build (UTC). O deploy de produção roda depois de cada geração diária de puzzles, então a data do build corresponde à última mudança de conteúdo das páginas;
- dois `xhtml:link rel="alternate"` (`pt-BR` e `en`), iguais aos do `<head>`. O `x-default` fica só no `<head>`.

O `seo:verify` passou a exigir `dist/404.html` com `noindex` e sem canonical, um `<lastmod>` por URL e dois alternates por URL.

A raiz `/` segue como alias com canonical para `/pt-br/`, como decidido na ADR 018.

## Alternativas consideradas

### Data da última alteração por página via Git

Daria um `lastmod` por rota, mas o checkout do CI é raso e o conteúdo que muda todo dia está em `web/public/data/`, não nos arquivos `.astro`. A data do build é mais fiel ao que o visitante vê.

### Regra `_redirects` para um 404

O Cloudflare Pages já usa `404.html` sem configuração extra. Uma regra a mais não traria ganho.

## Consequências

- Caminhos inexistentes deixam de ser soft 404 e saem do relatório de cobertura com o tempo.
- Todo deploy atualiza o `lastmod` das 14 URLs.
- A página 404 não entra no sitemap nem no `llms.txt`.
