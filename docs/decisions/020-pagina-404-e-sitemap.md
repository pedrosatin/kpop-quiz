# ADR 020. Página 404 e hreflang no sitemap

## Status

Aceita. Desde a [ADR 022](022-renderizacao-e-texto-indexavel.md), o `robots.txt` não bloqueia mais `/data/`. A decisão sobre `<lastmod>` continua valendo, porque os JSON seguem fora do sitemap e do índice.

## Data

2026-10-04

## Contexto

O build não gerava `404.html`. Sem esse arquivo, o Cloudflare Pages trata o site como SPA e responde qualquer caminho inexistente (por exemplo `/nao-existe-xyz` ou `/sitemap-index.xml`) com HTTP 200 e o HTML da raiz, que tem canonical para `/pt-br/`. O Search Console classifica essas respostas como soft 404.

O `sitemap.xml` da [ADR 018](018-seo-llm-indexing.md) listava só `<loc>`, sem alternates de idioma.

## Decisão

`web/src/pages/404.astro` gera `dist/404.html`. Com esse arquivo na raiz, o Cloudflare Pages serve a página com HTTP 404 para rotas desconhecidas, e o GitHub Pages da homologação faz o mesmo. A página usa o `BaseLayout` sem `canonicalPath`. Sem essa prop, o layout não emite canonical, hreflang, `og:url` nem JSON-LD. Ela é sempre `noindex`, tem texto em português e em inglês e lista os sete jogos nos dois idiomas. Os links levam o prefixo `base` da homologação.

O sitemap continua sendo o endpoint `sitemap.xml.ts`, agora montado por `web/src/lib/sitemap.ts`. Cada URL recebe dois `xhtml:link rel="alternate"` (`pt-BR` e `en`), iguais aos do `<head>`. O `x-default` fica só no `<head>`.

O sitemap não tem `<lastmod>`. O `robots.txt` de produção bloqueia `/data/`, onde ficam os puzzles diários, então o Googlebot só lê o HTML das 14 rotas. Esse HTML muda apenas quando o código muda. Uma data de build mudaria a cada deploy sem mudança no conteúdo rastreável, e o Google deixa de considerar o `lastmod` de um site quando ele não corresponde a mudanças reais.

O `seo:verify` passou a exigir `dist/404.html` com `noindex` e sem canonical, hreflang, `og:url` ou `application/ld+json`, além de dois alternates por URL no sitemap.

A raiz `/` segue como alias com canonical para `/pt-br/`, como decidido na ADR 018.

## Alternativas consideradas

### `lastmod` com a data do build

O deploy de produção roda depois de cada geração diária de puzzles, então as 14 URLs ganhariam data nova todo dia. O conteúdo que muda diariamente está em `/data/`, fora do rastreamento, e o HTML das rotas fica igual entre esses deploys. A data seria falsa para o Google.

### `lastmod` por página via Git

Daria uma data por rota a partir do último commit que tocou o `.astro`. O checkout do CI é raso, e o HTML de cada rota depende também do layout, do catálogo de textos e dos componentes compartilhados. Mapear essas dependências para cada rota custaria mais do que o sinal vale para 14 URLs.

### Regra `_redirects` para um 404

O Cloudflare Pages já usa `404.html` sem configuração extra. Uma regra a mais não traria ganho.

## Consequências

- Caminhos inexistentes passam a responder 404, e o Search Console os retira do relatório de soft 404 quando rastrear de novo.
- O sitemap fica igual entre deploys enquanto as rotas não mudam.
- A página 404 não entra no sitemap nem no `llms.txt`.
