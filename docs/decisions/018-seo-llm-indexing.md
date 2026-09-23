# ADR 018. SEO e indexação para LLMs

## Status

Aceita

## Data

2026-09-23

## Contexto

A produção serve o Astro estático na raiz de `https://kpopquiz.online`
([ADR 013](013-cloudflare-pages.md)). A homologação (`dev`, GitHub Pages,
`https://pedrosatin.github.io/kpop-quiz/`) emite `noindex` via o flag
`isStaging = BASE_URL !== ""` no `BaseLayout.astro`
([ADR 016](016-homologacao-github-pages.md)). Não existia `sitemap.xml`,
`robots.txt`, `llms.txt`, `_headers`, nem metadados por rota: todas as
páginas repetiam `messages.intro` como description e não emitiam
`canonical`, `hreflang` ou Open Graph.

O site tem 10 rotas de conteúdo (5 jogos × 2 idiomas). O redirect `/`
(para `/pt-br/`) carrega `noindex` permanente. O jogo de linha do tempo
não tem rotas web (só `timeline.daily.json` + fixtures), então o sitemap
cobre exatamente 10 URLs. `web/public/data/` (~159 JSON) nunca entra no
índice. Query strings (`?mode`, `?theme`) são variantes de apresentação
da mesma URL e se resolvem via `canonical`.

## Decisão

Host canônico: `https://kpopquiz.online`. Todo `canonical`, `hreflang`
alternates, `og:url` e `og:image` usam URLs absolutas desse host, nos
builds de produção e homologação. A homologação continua `noindex` em
todas as páginas, então o canônico absoluto nunca cria conteúdo
duplicado indexável.

Tabela hreflang (5 pares + `x-default` apontando para `pt-BR`, destino do
redirect `/`):

| pt-BR | en | x-default |
|---|---|---|
| `/pt-br/` | `/en/` | `/pt-br/` |
| `/pt-br/grid/` | `/en/grid/` | — |
| `/pt-br/conexoes/` | `/en/connections/` | — |
| `/pt-br/adivinhe/` | `/en/guess/` | — |
| `/pt-br/caca-palavras/` | `/en/word-search/` | — |

Fora do índice: redirect `/`, `/data/*`, homologação inteira,
`?mode`/`?theme`.

Sitemap e robots são endpoints gerados (`sitemap.xml.ts` + `robots.txt.ts`),
sem dependências novas (sem `@astrojs/sitemap`, sem churn no
`package-lock.json`), com tabela de rotas explícita em
`web/src/lib/seo-routes.ts`. Produção: `Allow: /`, `Disallow: /data/`,
`Sitemap: https://kpopquiz.online/sitemap.xml`. Com prefixo `BASE_URL`
(homologação): `Disallow: /`. Nenhum `robots.txt` estático em
`web/public/`. Defesa em profundidade: `web/public/_headers` com
`X-Robots-Tag: noindex` para `/data/*`, e nenhum `<a href>` para
`/data/` nos HTMLs.

OG image: reutiliza `apple-touch-icon.png` (absoluta); design dedicado
fica para depois. `og:type=website`, `og:locale` (`pt_BR`/`en_US`) +
alternate nos dois idiomas, Twitter card `summary`.

Indexação para LLMs: `web/public/llms.txt` + um Markdown por rota
(`web/public/llms/*.md`, 10 arquivos), fora do sitemap, com resumo, URLs
absolutas, nota de proveniência (Wikidata CC0 + Wikipedia CC BY-SA 4.0
com revisão por resposta) e licença. O conteúdo confere com o H1/intro
visível de cada rota.

Medição: após o passo do operador (Search Console/Bing, B8), acompanhar
cobertura do sitemap, cliques por rota/idioma e Core Web Vitals. Snapshot
basal é dado do operador.

## Alternativas consideradas

### `@astrojs/sitemap`

Gera o sitemap automaticamente, mas adiciona dependência e integrações ao
`package.json`/`package-lock.json` para um site de 10 URLs fixas. A
tabela explícita é mais legível e testável.

### `robots.txt` estático em `web/public/`

Um arquivo estático não distingue produção de homologação; a versão de
staging precisa de `Disallow: /`. O endpoint lê `BASE_URL` no build e
emite a variante correta por ambiente.

### Canonical relativo ao ambiente (staging aponta para si)

Apontar o canônico da homologação para o próprio host prefixed criaria
URLs canônicas duplicadas fora do host oficial. Com `noindex` + canônico
para a produção, os dois sinais concordam.

## Consequências

- `npm run seo:verify` + passos em `pages.yml`/`staging.yml` afirmam:
  sitemap parseável com 10 URLs, robots por env, prod sem `noindex`
  (exceto o redirect `/`), staging com `noindex`, sem `/data/` no sitemap.
- Títulos de meta ≤60 chars e descrições ≤155 chars por rota por idioma,
  cobertos por teste em `web/src/i18n/catalog.test.ts`.
- B8 (Search Console/Bing: verificar propriedade, submeter sitemap,
  monitorar cobertura e Core Web Vitals) é passo do operador, fora do código.
